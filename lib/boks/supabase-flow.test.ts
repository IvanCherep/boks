import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildReaderFeed,
  buildRecommendationLab,
  normalizeExperimentConfig,
  type StoryCandidate,
} from "@/lib/boks/recommendations";

/**
 * End-to-end check of the Supabase contract the browser depends on: RPC names,
 * argument names and payload shapes, plus the ranking and lab math running on
 * real rows.
 *
 * Runs only against a local stack. Email links come from its Mailpit inbox;
 * admin bootstrap is an explicit local operator step, never a reader RPC:
 *
 *   npx supabase start
 *   npm run test:supabase -- --no-reset
 *
 * Without `SUPABASE_LOCAL_URL` and `SUPABASE_LOCAL_PUBLISHABLE_KEY` the suite is
 * skipped, so `npm test` stays offline.
 */

const url = process.env.SUPABASE_LOCAL_URL;
const publishableKey = process.env.SUPABASE_LOCAL_PUBLISHABLE_KEY;
const canRun = Boolean(url && publishableKey);

function browserClient() {
  return createClient(url as string, publishableKey as string, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

type MailSummary = { ID: string; To: { Address: string }[] };

/** Follow the local email's actual OTP link, without printing credentials. */
async function verifyLocalEmail(client: SupabaseClient, email: string) {
  const mailbox = "http://127.0.0.1:54324";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const inbox = await fetch(`${mailbox}/api/v1/messages?limit=100`).then((response) => response.json()) as { messages: MailSummary[] };
    const entry = inbox.messages.find((message) => message.To.some((recipient) => recipient.Address.toLowerCase() === email.toLowerCase()));
    if (entry) {
      const mail = await fetch(`${mailbox}/api/v1/message/${entry.ID}`).then((response) => response.json()) as { HTML: string; Text: string };
      const match = `${mail.HTML} ${mail.Text}`.replace(/&amp;/g, "&").match(/https?:\/\/[^\s"<>]+\/auth\/v1\/verify\?[^\s"<>]+/);
      if (!match) throw new Error("Local sign-in email has no verification link.");
      const link = new URL(match[0]);
      if (!["127.0.0.1", "localhost"].includes(link.hostname)) throw new Error("Refusing a non-local email verification link.");
      const tokenHash = link.searchParams.get("token");
      if (!tokenHash) throw new Error("Local email has no verification token.");
      const type = link.searchParams.get("type") as "signup" | "magiclink" | "email_change";
      const result = await client.auth.verifyOtp({ token_hash: tokenHash, type });
      if (result.error) throw result.error;
      return result.data.user;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Local sign-in email did not reach Mailpit.");
}

async function finishLocalProfile(client: SupabaseClient, displayName: string) {
  const profile = await client.rpc("ensure_boks_user_profile", { p_display_name: displayName });
  if (profile.error) throw profile.error;
  const terms = await client.rpc("accept_boks_terms", { p_terms_version: "v1" });
  if (terms.error) throw terms.error;
  return terms;
}

async function signUp(client: SupabaseClient, email: string, displayName: string) {
  const sent = await client.auth.signInWithOtp({ email });
  if (sent.error) throw sent.error;
  const user = await verifyLocalEmail(client, email);
  await finishLocalProfile(client, displayName);
  return user;
}

/** The same guest identity can verify its email without ever choosing a password. */
async function upgradeAnonymousReader(client: SupabaseClient, email: string, displayName: string) {
  const guest = await client.auth.signInAnonymously();
  if (guest.error) throw guest.error;
  const upgrade = await client.auth.updateUser({ email });
  if (upgrade.error) throw upgrade.error;
  await verifyLocalEmail(client, email);
  await finishLocalProfile(client, displayName);
  return client.rpc("update_boks_user_profile", { p_display_name: displayName, p_handle: "" });
}

async function bootstrapLocalAdmin(client: SupabaseClient) {
  const user = (await client.auth.getUser()).data.user;
  if (!user || !/^[0-9a-f-]{36}$/.test(user.id)) throw new Error("Missing local admin identity.");
  // The local stack's operator connection bypasses RLS only for bootstrap.
  // Its target is fixed to the repository's local Docker container.
  execFileSync("docker", ["exec", "supabase_db_fd", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
    `update public.user_profiles set role = 'admin' where user_id = '${user.id}'::uuid;`], { stdio: "pipe" });
  const context = await client.rpc("get_boks_user_context");
  expect(context.error).toBeNull();
  expect(context.data.role).toBe("admin");
}

async function submitBok(
  client: SupabaseClient,
  title: string,
  authorName = "",
  // Unique per title: the database refuses the same text twice from one author.
  text = `${title}: a short bok body that fits comfortably inside a fifteen minute break.`,
  rights: { confirmed?: boolean; note?: string } = {}
) {
  return client.rpc("submit_bok_for_review", {
    p_title: title,
    p_hook: "A hook for the flow check.",
    p_text: text,
    p_genre: "literary",
    p_mood: "quiet",
    p_minutes: 4,
    p_author_name: authorName,
    p_rights_confirmed: rights.confirmed ?? true,
    p_rights_note: rights.note ?? "",
  });
}

describe.skipIf(!canRun)("Supabase product flow", () => {
  let author: SupabaseClient;
  let admin: SupabaseClient;
  let reader: SupabaseClient;
  let stamp: string;

  beforeAll(async () => {
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url ?? "")) throw new Error("Product flow tests require a local Supabase URL.");
    stamp = `${Date.now()}`;
    author = browserClient();
    admin = browserClient();
    reader = browserClient();

    await signUp(author, `author-${stamp}@boks.test`, "Flow Author");
    await signUp(admin, `admin-${stamp}@boks.test`, "Flow Admin");

    // A guest reader is a real anonymous Supabase user, not the `anon` role.
    const guest = await reader.auth.signInAnonymously();
    if (guest.error) throw guest.error;
  });

  it("lets a guest reader become an author without a second sign-in", async () => {
    const upgrading = browserClient();
    const profile = await upgradeAnonymousReader(upgrading, `upgrade-${stamp}@boks.test`, "Upgraded Reader");

    expect(profile.error).toBeNull();
    expect(profile.data.isAnonymous).toBe(false);

    const submitted = await submitBok(upgrading, `Upgrade bok ${stamp}`);
    expect(submitted.error).toBeNull();
  });

  it("publishes under a pen name, and remembers it for the next one", async () => {
    const chosen = await submitBok(author, `Byline bok ${stamp}`, "Mira Vale");
    expect(chosen.error).toBeNull();
    // The byline is the author's choice for this piece; the @handle is who they are.
    expect(chosen.data.authorName).toBe("Mira Vale");
    expect(chosen.data.authorHandle).toBe(`author_${stamp}`);

    const remembered = await author.rpc("get_my_default_author_name");
    expect(remembered.error).toBeNull();
    expect(remembered.data).toBe("Mira Vale");
  });

  it("publishes with no byline at all when none is given", async () => {
    const fresh = browserClient();
    await signUp(fresh, `first-${stamp}@boks.test`, "");
    const result = await submitBok(fresh, `First bok ${stamp}`);

    expect(result.error).toBeNull();
    // A byline is optional. The reader is attributed by the @handle, which is
    // joined from the profile, so nothing is stored on the work.
    expect(result.data.authorName).toBeNull();
    expect(result.data.authorHandle).toBe(`first_${stamp}`);
    await fresh.auth.signOut();
  });

  it("refuses a bok that cannot fit inside fifteen minutes", async () => {
    const tooLong = await submitBok(author, `Too long ${stamp}`, "", "a ".repeat(12_000));

    expect(tooLong.error).not.toBeNull();
    expect(tooLong.error?.message).toMatch(/fifteen minutes|15 minutes/i);
  });

  it("derives the @nickname from the email, asking the reader for nothing", async () => {
    const fresh = browserClient();
    await signUp(fresh, `derived.${stamp}@boks.test`, "");
    const context = await fresh.rpc("get_boks_user_context");

    expect(context.error).toBeNull();
    expect(context.data.handle).toBe(`derived_${stamp}`);
    await fresh.auth.signOut();
  });

  it("saves a nickname with an underscore, and refuses one that breaks the rule", async () => {
    const fresh = browserClient();
    await signUp(fresh, `nickname.${stamp}@boks.test`, "");

    const saved = await fresh.rpc("update_boks_user_profile", {
      p_display_name: "",
      p_handle: `ivan_ystal_${stamp}`.slice(0, 24),
    });
    expect(saved.error).toBeNull();
    expect(saved.data.handle).toBe(`ivan_ystal_${stamp}`.slice(0, 24));

    // A leading `@` is what a reader types out of habit, and is not a refusal.
    const withAt = await fresh.rpc("update_boks_user_profile", {
      p_display_name: "",
      p_handle: `@ivan_${stamp}`.slice(0, 24),
    });
    expect(withAt.error).toBeNull();
    expect(withAt.data.handle).toBe(`ivan_${stamp}`.slice(0, 24));

    // The rules, each named in the message rather than reported as "invalid".
    for (const [handle, expected] of [
      ["9ivan", /start with a letter/i],
      ["_ivan", /start with a letter/i],
      ["иван_ivan", /English letters/i],
      ["ivan.ystal", /English letters/i],
      ["ab", /at least 3/i],
      ["a".repeat(25), /at most 24/i],
    ] as const) {
      const refused = await fresh.rpc("update_boks_user_profile", { p_display_name: "", p_handle: handle });
      expect(refused.error, `handle ${handle}`).not.toBeNull();
      expect(refused.error?.message, `handle ${handle}`).toMatch(expected);
    }

    // A nickname someone else holds is refused with a sentence, not a
    // constraint name: this is the one every reader will actually hit.
    const taken = await fresh.rpc("update_boks_user_profile", {
      p_display_name: "",
      p_handle: `derived_${stamp}`,
    });
    expect(taken.error).not.toBeNull();
    expect(taken.error?.message).toBe("That nickname is taken.");

    // Refused attempts changed nothing.
    const context = await fresh.rpc("get_boks_user_context");
    expect(context.data.handle).toBe(`ivan_${stamp}`.slice(0, 24));
    await fresh.auth.signOut();
  });

  it("lets an author submit more than three boks a day", async () => {
    // One submission was already spent by the byline check above.
    for (let index = 2; index <= 5; index += 1) {
      const result = await submitBok(author, `Flow bok ${stamp}-${index}`);
      expect(result.error, `submission ${index}`).toBeNull();
    }

    const quota = await author.rpc("get_my_bok_quota");
    expect(quota.error).toBeNull();
    expect(quota.data?.unlimited).toBe(true);
    expect(quota.data?.exhausted).toBe(false);
  });

  it("pages an author's history with counts by status", async () => {
    const page = await author.rpc("get_my_bok_submissions_page", { p_status: "", p_query: "", p_limit: 2, p_offset: 0 });
    expect(page.error).toBeNull();
    expect(page.data.items).toHaveLength(2);
    expect(page.data.counts.pending_review).toBeGreaterThanOrEqual(5);
  });

  it("keeps submitted boks out of the reader feed until an admin approves", async () => {
    const pending = await reader
      .from("reels")
      .select("id,title")
      .eq("status", "published")
      .like("title", `Flow bok ${stamp}%`);

    expect(pending.error).toBeNull();
    expect(pending.data ?? []).toHaveLength(0);
  });

  it("publishes a bok once an admin approves it, and refuses one with a reason", async () => {
    const claim = await admin.rpc("claim_initial_boks_admin");
    expect(claim.error).not.toBeNull();
    await bootstrapLocalAdmin(admin);

    const snapshot = await admin.rpc("get_boks_admin_snapshot", {
      p_limit: 50,
      p_offset: 0,
      p_query: `Flow bok ${stamp}`,
      p_sort: "signal",
    });
    expect(snapshot.error).toBeNull();

    const queue = (snapshot.data?.moderationQueue ?? []) as Array<{ id: string; title: string }>;
    expect(queue.length).toBeGreaterThanOrEqual(2);

    const approved = await admin.rpc("review_bok_submission", {
      p_bok_id: queue[0].id,
      p_decision: "approve",
      p_reason: "",
    });
    expect(approved.error).toBeNull();
    expect(approved.data.status).toBe("published");

    const refused = await admin.rpc("review_bok_submission", {
      p_bok_id: queue[1].id,
      p_decision: "reject",
      p_reason: "Needs a stronger ending.",
    });
    expect(refused.error).toBeNull();
    expect(refused.data.status).toBe("rejected");

    const authorView = await author.rpc("get_my_bok_submissions", { p_limit: 50 });
    expect(authorView.error).toBeNull();
    const statuses = (authorView.data as Array<{ status: string; reviewNote: string | null }>).map((row) => row.status);
    expect(statuses).toContain("published");
    expect(statuses).toContain("rejected");
    expect(
      (authorView.data as Array<{ reviewNote: string | null }>).some(
        (row) => row.reviewNote === "Needs a stronger ending."
      )
    ).toBe(true);
  });

  it("imports a catalogue into a publisher account, once", async () => {
    // Runs after the moderation test, which is where this suite's admin gets
    // its role.
    const adminClient = admin;

    const publisherHandle = `press_${stamp}`.slice(0, 24);
    const publisherClient = browserClient();
    await signUp(publisherClient, `press.${stamp}@boks.test`, "");
    await publisherClient.rpc("update_boks_user_profile", { p_display_name: "", p_handle: publisherHandle });

    // Nothing can be imported into an account nobody has marked.
    const unmarked = await adminClient.rpc("import_boks_batch", {
      p_publisher_handle: publisherHandle,
      p_rows: [{ importKey: "a", title: "A", text: "Text." }],
      p_rights_confirmed: true,
    });
    expect(unmarked.error?.message).toMatch(/not a publisher account/);

    await adminClient.rpc("set_boks_publisher", { p_handle: publisherHandle, p_is_publisher: true });

    const rows = [
      { importKey: "flow-1", title: "Credited", text: "A piece.", authorName: "Abel Mensah" },
      { importKey: "flow-2", title: "Uncredited", text: "Another piece." },
    ];

    const first = await adminClient.rpc("import_boks_batch", {
      p_publisher_handle: publisherHandle,
      p_rows: rows,
      p_rights_confirmed: true,
      p_rights_note: "Public domain, verified against the source.",
    });
    expect(first.error).toBeNull();
    expect(first.data.imported).toBe(2);

    const again = await adminClient.rpc("import_boks_batch", {
      p_publisher_handle: publisherHandle,
      p_rows: rows,
      p_rights_confirmed: true,
    });
    expect(again.data.skipped).toBe(2);
    expect(again.data.imported).toBe(0);

    // What a reader gets: the publisher's @handle on both, a byline on one.
    const published = await browserClient()
      .from("published_boks")
      .select("title,author_name,author_handle")
      .eq("author_handle", publisherHandle)
      .order("title");
    expect(published.error).toBeNull();
    expect(published.data).toEqual([
      { title: "Credited", author_name: "Abel Mensah", author_handle: publisherHandle },
      { title: "Uncredited", author_name: null, author_handle: publisherHandle },
    ]);

    // And a reader can follow the publisher like any other author.
    const follower = browserClient();
    await signUp(follower, `follows.press.${stamp}@boks.test`, "");
    const followed = await follower.rpc("set_author_follow", {
      p_author_user_id: (await publisherClient.auth.getUser()).data.user!.id,
      p_following: true,
    });
    expect(followed.error).toBeNull();

    await adminClient.rpc("delete_boks_import", {
      p_publisher_handle: publisherHandle,
      p_import_key_prefix: "flow-",
      p_confirm: "flow-",
    });

    await Promise.all([publisherClient.auth.signOut(), follower.auth.signOut()]);
  });

  it("keeps rights private, and lets a reader report a bok an admin can take down", async () => {
    // A fresh author: the shared one has spent its three submissions for the day.
    const rightsAuthor = browserClient();
    await signUp(rightsAuthor, `rights.author.${stamp}@boks.test`, "");

    const submitted = await submitBok(rightsAuthor, `Rights bok ${stamp}`, "", undefined, {
      confirmed: true,
      note: "Project Gutenberg #1342, public domain.",
    });
    expect(submitted.error).toBeNull();
    const reelId = submitted.data.id as string;

    // Publishing without the attestation is refused, and says what is missing.
    const unattested = await submitBok(rightsAuthor, `Unattested ${stamp}`, "", undefined, { confirmed: false });
    expect(unattested.error?.message).toMatch(/rights/i);

    await admin.rpc("review_bok_submission", { p_bok_id: reelId, p_decision: "approve", p_reason: "" });

    // The note is admin-only. A reader can select `reels` directly, so this is
    // the check that matters: it must not be reachable from the reader's side.
    const readerRights = await reader.from("bok_rights").select("note");
    expect(readerRights.error ?? { message: "" }).toBeTruthy();
    expect(readerRights.data ?? []).toEqual([]);

    const bokRow = await reader.from("reels").select("*").eq("id", reelId).maybeSingle();
    expect(bokRow.error).toBeNull();
    expect(Object.keys(bokRow.data ?? {})).not.toContain("rights_note");

    // A guest can report without verifying an email or accepting terms: the
    // person whose work was taken need not first create a permanent account.
    expect((await reader.auth.getUser()).data.user?.is_anonymous).toBe(true);
    const guestReport = await reader.rpc("report_bok", {
      p_reel_id: reelId,
      p_reason: "This is my translation, published in 1998 without permission.",
      p_kind: "copyright",
    });
    expect(guestReport.error).toBeNull();
    expect(guestReport.data.status).toBe("received");
    const guestAgain = await reader.rpc("report_bok", {
      p_reel_id: reelId,
      p_reason: "A second explanation must not create a second open report.",
      p_kind: "other",
    });
    expect(guestAgain.error).toBeNull();
    expect(guestAgain.data).toEqual({ status: "already", id: guestReport.data.id });
    const guestReports = await reader.from("bok_reports").select("reason");
    expect(guestReports.error).toBeNull();
    expect(guestReports.data).toEqual([]);

    const reporter = browserClient();
    await signUp(reporter, `rights.reader.${stamp}@boks.test`, "");
    const report = await reporter.rpc("report_bok", {
      p_reel_id: reelId,
      p_reason: "This is my translation, published in 1998 without permission.",
      p_kind: "copyright",
    });
    expect(report.error).toBeNull();
    expect(report.data.status).toBe("received");

    const twice = await reporter.rpc("report_bok", {
      p_reel_id: reelId,
      p_reason: "This is my translation, published in 1998 without permission.",
      p_kind: "copyright",
    });
    expect(twice.error).toBeNull();
    expect(twice.data).toEqual({ status: "already", id: report.data.id });

    // A reader cannot read the complaints, not even their own.
    const readerReports = await reporter.from("bok_reports").select("reason");
    expect(readerReports.error).toBeNull();
    expect(readerReports.data).toEqual([]);

    // The admin sees the complaint next to what the author claimed.
    const review = await admin.rpc("get_boks_rights_review", { p_status: "open", p_limit: 50 });
    expect(review.error).toBeNull();
    const bokReports = (review.data.reports as Array<Record<string, unknown>>).filter((row) => row.reelId === reelId);
    expect(bokReports).toHaveLength(2);
    expect(bokReports.map((row) => row.id)).toEqual(expect.arrayContaining([guestReport.data.id, report.data.id]));
    const mine = bokReports.find((row) => row.id === guestReport.data.id);
    expect(mine?.reason).toMatch(/my translation/);
    expect(mine?.rightsNote).toBe("Project Gutenberg #1342, public domain.");
    expect(mine?.rightsConfirmed).toBe(true);

    // Acting on it takes the bok out of the feed, which review_bok_submission
    // cannot do for a published piece.
    const actioned = await admin.rpc("review_bok_report", {
      p_report_id: mine!.id,
      p_decision: "actioned",
      p_note: "Confirmed with the translator.",
    });
    expect(actioned.error).toBeNull();
    expect(actioned.data.bokStatus).toBe("rejected");

    const gone = await reader.from("published_boks").select("id").eq("id", reelId);
    expect(gone.data ?? []).toEqual([]);

    // And the author is told why.
    const mySubmissions = await rightsAuthor.rpc("get_my_bok_submissions", { p_limit: 50 });
    const withdrawn = (mySubmissions.data as Array<{ id: string; reviewNote: string | null }>).find(
      (row) => row.id === reelId
    );
    expect(withdrawn?.reviewNote).toMatch(/translator/);

    await Promise.all([rightsAuthor.auth.signOut(), reporter.auth.signOut()]);
  });

  it("ranks a real candidate set and records attributed events", async () => {
    const anonymous = browserClient();
    const signIn = await anonymous.auth.signInAnonymously();
    expect(signIn.error).toBeNull();

    const experimentResult = await anonymous.rpc("get_active_recommendation_experiment");
    expect(experimentResult.error).toBeNull();
    const experimentConfig = normalizeExperimentConfig(experimentResult.data);
    expect(experimentConfig.arms.length).toBeGreaterThan(0);

    const candidatesResult = await anonymous.rpc("get_recommendation_candidates", { p_limit: 200 });
    expect(candidatesResult.error).toBeNull();

    const candidates = (candidatesResult.data as Array<Record<string, unknown>>).map(
      (row): StoryCandidate => ({
        id: String(row.id),
        title: String(row.title),
        genre: String(row.genre),
        mood: String(row.mood),
        minutes: Number(row.minutes),
        wordCount: Number(row.wordCount),
        createdAt: String(row.createdAt),
        impressions: Number(row.impressions),
        starts: Number(row.starts),
        completes: Number(row.completes),
        skips: Number(row.skips),
        likes: Number(row.likes),
        shares: Number(row.shares),
        comments: Number(row.comments),
        readSecondsTotal: Number(row.readSecondsTotal),
      })
    );
    expect(candidates.length).toBeGreaterThan(0);

    const feed = buildReaderFeed({ visitorId: `flow-${stamp}`, candidates, experimentConfig, limit: 20 });
    expect(feed.entries.length).toBeGreaterThan(0);
    expect(feed.entries[0].rank).toBe(0);

    const top = feed.entries[0];
    const attribute = (eventType: string, value: number) => ({
      eventType,
      storyId: top.candidate.id,
      value,
      algorithmId: feed.experiment.algorithmId,
      experimentKey: feed.experiment.experimentKey,
      userSegment: feed.experiment.userSegment,
      surface: "reader",
      rank: top.rank,
      clientElapsedSeconds: value,
      sessionId: `session-${stamp}`,
      visitorId: `flow-${stamp}`,
      estimatedSeconds: top.candidate.minutes * 60,
    });

    const assignment = await anonymous.rpc("record_recommendation_assignment", {
      p_experiment_key: feed.experiment.experimentKey,
      p_algorithm_id: feed.experiment.algorithmId,
      p_user_segment: feed.experiment.userSegment,
      p_visitor_id: `flow-${stamp}`,
    });
    expect(assignment.error).toBeNull();

    const written = await anonymous.rpc("record_recommendation_events", {
      p_events: [attribute("impression", 1), attribute("start", 1), attribute("complete", 190)],
    });
    expect(written.error).toBeNull();
    expect(written.data).toBe(3);

    const blockedRead = await anonymous.from("recommendation_events").select("id");
    expect(blockedRead.data ?? []).toHaveLength(0);
  });

  it("returns reader outcomes an admin can turn into a comparison", async () => {
    const labResult = await admin.rpc("get_recommendation_lab", { p_days: 30 });
    expect(labResult.error).toBeNull();
    const experiment = normalizeExperimentConfig(labResult.data.experiment);

    const outcomes = await admin.rpc("get_reader_outcomes", {
      p_days: 30,
      p_experiment_key: experiment.key,
    });
    expect(outcomes.error).toBeNull();

    // One row per (reader, algorithm, day): the analysis unit, straight from
    // the database, before anything divides.
    const rows = (outcomes.data as Record<string, unknown>[]).map((row) => ({
      userId: String(row.userId),
      algorithmId: String(row.algorithmId),
      day: String(row.day),
      impressions: Number(row.impressions),
      starts: Number(row.starts),
      completes: Number(row.completes),
      skips: Number(row.skips),
      likes: Number(row.likes),
      shares: Number(row.shares),
      comments: Number(row.comments),
      cohortWeek: String(row.cohortWeek ?? ""),
      tenureDays: Number(row.tenureDays ?? 0),
      boksOpened: Number(row.boksOpened),
      sessions: Number(row.sessions),
      activeSeconds: Number(row.activeSeconds),
      attributedEvents: Number(row.attributedEvents),
      totalEvents: Number(row.totalEvents),
    }));

    const report = buildRecommendationLab(rows, {
      controlAlgorithmId: experiment.controlAlgorithmId,
      minimumReadersPerArm: 10,
      windowDays: 30,
    });

    expect(report.analysisUnit).toBe("reader");
    expect(report.arms.length).toBeGreaterThan(0);
    expect(report.totals.readers).toBeGreaterThan(0);
    // A handful of test readers cannot support a verdict, and the report says
    // so rather than printing one.
    for (const comparison of report.comparisons) {
      expect(comparison.status).toBe("insufficient_data");
    }
  });

  it("lets an admin change the live split and refuses a reader the same change", async () => {
    const saved = await admin.rpc("save_recommendation_experiment", {
      p_key: "boks-feed-v1",
      p_control_algorithm_id: "balanced",
      p_arms: [
        { algorithmId: "balanced", weight: 60 },
        { algorithmId: "taste_match", weight: 40 },
      ],
      p_minimum_impressions_per_arm: 30,
    });
    expect(saved.error).toBeNull();
    expect(normalizeExperimentConfig(saved.data).arms).toHaveLength(2);

    const refused = await author.rpc("save_recommendation_experiment", {
      p_key: "boks-feed-v1",
      p_control_algorithm_id: "balanced",
      p_arms: [{ algorithmId: "balanced", weight: 100 }],
      p_minimum_impressions_per_arm: 10,
    });
    expect(refused.error?.message).toContain("Admin access required");

    // Restore the default split so a rerun starts from the seeded state.
    await admin.rpc("save_recommendation_experiment", {
      p_key: "boks-feed-v1",
      p_control_algorithm_id: "balanced",
      p_arms: [
        { algorithmId: "balanced", weight: 25 },
        { algorithmId: "completion_first", weight: 25 },
        { algorithmId: "reaction_first", weight: 25 },
        { algorithmId: "discovery", weight: 25 },
      ],
      p_minimum_impressions_per_arm: 40,
    });
  });
});
