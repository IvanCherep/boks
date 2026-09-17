import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeBokSubmissionQuota } from "@/lib/boks/author/submission-quota";
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
 * Runs only against a local stack, because it creates users and content, and
 * it needs a database with no admin yet so the first-admin claim is available:
 *
 *   npx supabase start
 *   npx supabase db reset          # required before a rerun
 *   npm run test:supabase
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

async function signUp(client: SupabaseClient, email: string, displayName: string) {
  const result = await client.auth.signUp({ email, password: "boks-local-password" });
  if (result.error) throw result.error;
  const profile = await client.rpc("ensure_boks_user_profile", { p_display_name: displayName });
  if (profile.error) throw profile.error;
  return result.data.user;
}

/** The reader path: a guest starts anonymous and upgrades in place. */
async function upgradeAnonymousReader(client: SupabaseClient, email: string, displayName: string) {
  const guest = await client.auth.signInAnonymously();
  if (guest.error) throw guest.error;

  const upgrade = await client.auth.updateUser({ email, password: "boks-local-password" });
  if (upgrade.error) throw upgrade.error;

  const refreshed = await client.auth.refreshSession();
  if (refreshed.error) throw refreshed.error;

  return client.rpc("update_boks_user_profile", { p_display_name: displayName, p_handle: "" });
}

async function submitBok(
  client: SupabaseClient,
  title: string,
  authorName = "",
  text = "A short bok body that fits comfortably inside a fifteen minute break.",
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

  it("caps an author at three submissions a day", async () => {
    // One submission was already spent by the byline check above.
    for (let index = 2; index <= 3; index += 1) {
      const result = await submitBok(author, `Flow bok ${stamp}-${index}`);
      expect(result.error, `submission ${index}`).toBeNull();
    }

    const fourth = await submitBok(author, `Flow bok ${stamp}-4`);
    expect(fourth.error?.message).toContain("Daily limit reached");
  });

  it("reports the remaining quota through the RPC the cabinet reads", async () => {
    const quota = await author.rpc("get_my_bok_quota");
    expect(quota.error).toBeNull();

    const parsed = normalizeBokSubmissionQuota(quota.data);
    expect(parsed.limit).toBe(3);
    expect(parsed.usedToday).toBe(3);
    expect(parsed.exhausted).toBe(true);
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
    if (claim.error) {
      throw new Error(
        `Could not claim the first admin (${claim.error.message}). This suite needs a database with no admin yet - run \`npx supabase db reset\` and try again.`
      );
    }
    expect(claim.data.role).toBe("admin");

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

    // A guest reports it - the person whose work it is need not have an account.
    const report = await reader.rpc("report_bok", {
      p_reel_id: reelId,
      p_reason: "This is my translation, published in 1998 without permission.",
      p_kind: "copyright",
    });
    expect(report.error).toBeNull();
    expect(report.data.status).toBe("received");

    const twice = await reader.rpc("report_bok", {
      p_reel_id: reelId,
      p_reason: "This is my translation, published in 1998 without permission.",
      p_kind: "copyright",
    });
    expect(twice.data.status).toBe("already");

    // A reader cannot read the complaints, not even their own.
    const readerReports = await reader.from("bok_reports").select("reason");
    expect(readerReports.data ?? []).toEqual([]);

    // The admin sees the complaint next to what the author claimed.
    const review = await admin.rpc("get_boks_rights_review", { p_status: "open", p_limit: 50 });
    expect(review.error).toBeNull();
    const mine = (review.data.reports as Array<Record<string, unknown>>).find((row) => row.reelId === reelId);
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

    await rightsAuthor.auth.signOut();
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
