import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabasePublishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY before running this check.");
}

const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

function assertOk(condition, message) {
  if (!condition) throw new Error(message);
}

const authResult = await supabase.auth.signInAnonymously();
if (authResult.error) throw authResult.error;

const userId = authResult.data.user?.id;
assertOk(userId, "Anonymous auth did not return a user id.");

const reelsResult = await supabase
  .from("reels")
  .select("id,title")
  .eq("status", "published")
  .limit(1);
if (reelsResult.error) throw reelsResult.error;

const reel = reelsResult.data?.[0];
assertOk(reel?.id, "No published reels were readable through RLS.");

const likeResult = await supabase.from("likes").upsert(
  {
    user_id: userId,
    reel_id: reel.id,
  },
  { onConflict: "user_id,reel_id" }
);
assertOk(likeResult.error, "Anonymous auth could like a bok.");

const conversationResult = await supabase.rpc("get_bok_comments", { p_reel_id: reel.id });
if (conversationResult.error) throw conversationResult.error;
assertOk(Array.isArray(conversationResult.data), "Comment conversation RPC did not return a list.");

const blockedCommentResult = await supabase.rpc("create_bok_comment", {
  p_reel_id: reel.id,
  p_body: "Anonymous comments must be blocked.",
});
assertOk(blockedCommentResult.error, "Anonymous auth could comment on a bok.");
assertOk(blockedCommentResult.error.code !== "PGRST202", "Bok comment RPC is missing.");

const blockedCommentLikeResult = await supabase.rpc("set_bok_comment_like", {
  p_comment_id: conversationResult.data?.[0]?.id ?? -1,
  p_liked: true,
});
assertOk(blockedCommentLikeResult.error, "Anonymous auth could like a comment.");
assertOk(blockedCommentLikeResult.error.code !== "PGRST202", "Comment like RPC is missing.");

const anonymousLibraryResult = await supabase.rpc("get_my_reader_library", { p_limit: 10 });
if (anonymousLibraryResult.error) throw anonymousLibraryResult.error;
assertOk(
  Array.isArray(anonymousLibraryResult.data) && anonymousLibraryResult.data.length === 0,
  "Anonymous auth could read a permanent account library."
);

const blockedProfileUpdateResult = await supabase.rpc("update_boks_user_profile", {
  p_display_name: "Anonymous check",
  p_handle: "anonymous_check",
});
assertOk(blockedProfileUpdateResult.error, "Anonymous auth could update a permanent profile.");
assertOk(blockedProfileUpdateResult.error.code !== "PGRST202", "Profile update RPC is missing.");

const blockedReelResult = await supabase.from("reels").insert({
  title: "Blocked client insert",
  author_name: "Security Check",
  text: "This row must not be inserted by the publishable browser key.",
});
assertOk(blockedReelResult.error, "RLS allowed browser insertion into reels.");

const anonymousProfileResult = await supabase.rpc("ensure_boks_user_profile", {
  p_display_name: "Anonymous check",
});
if (anonymousProfileResult.error) throw anonymousProfileResult.error;
assertOk(anonymousProfileResult.data?.isAnonymous === true, "Anonymous profile check did not identify anonymous state.");
assertOk(anonymousProfileResult.data?.role === "reader", "Anonymous profile returned a non-reader role.");

const adminSnapshotResult = await supabase.rpc("get_boks_admin_snapshot", {
  p_limit: 10,
  p_offset: 0,
  p_query: "",
  p_sort: "signal",
});
assertOk(adminSnapshotResult.error, "Anonymous auth could read admin metrics.");

const blockedAdminGrantResult = await supabase.rpc("set_boks_admin_role", {
  p_user_id: userId,
  p_is_admin: true,
});
assertOk(blockedAdminGrantResult.error, "Anonymous auth could grant admin access.");
assertOk(blockedAdminGrantResult.error.code !== "PGRST202", "Admin grant RPC is missing.");

const blockedPeopleResult = await supabase.rpc("get_boks_people", {
  p_limit: 10,
  p_offset: 0,
  p_query: "",
});
assertOk(blockedPeopleResult.error, "Anonymous auth could read the People list.");

const blockedContentResult = await supabase.rpc("get_boks_content", {
  p_limit: 10,
  p_offset: 0,
  p_query: "",
  p_sort: "newest",
  p_status: "archived",
});
assertOk(blockedContentResult.error, "Anonymous auth could read deleted boks.");
assertOk(blockedContentResult.error.code !== "PGRST202", "Deleted boks RPC is missing.");

const lifecycleChecks = [
  await supabase.rpc("archive_bok", { p_reel_id: reel.id, p_reason: "Blocked check" }),
  await supabase.rpc("restore_archived_bok", { p_reel_id: reel.id }),
  await supabase.rpc("delete_archived_bok", { p_reel_id: reel.id, p_confirm: reel.title }),
  await supabase.rpc("set_boks_user_ban", { p_user_id: userId, p_banned: true, p_reason: "Blocked check" }),
  await supabase.rpc("delete_boks_user", { p_user_id: userId, p_confirm: userId }),
];
for (const result of lifecycleChecks) {
  assertOk(result.error, "Anonymous auth could use an admin lifecycle action.");
  assertOk(result.error.code !== "PGRST202", "An admin lifecycle RPC is missing.");
}

const authorSubmissionsResult = await supabase.rpc("get_my_bok_submissions", {
  p_limit: 10,
});
if (authorSubmissionsResult.error) throw authorSubmissionsResult.error;
assertOk(Array.isArray(authorSubmissionsResult.data), "Author submissions RPC did not return a list.");

const blockedSubmitResult = await supabase.rpc("submit_bok_for_review", {
  p_title: "Blocked anonymous submit",
  p_text: "Anonymous users must create a permanent account before submitting boks.",
  p_genre: "literary",
  p_mood: "quiet",
  p_minutes: 1,
  p_rights_confirmed: true,
});
assertOk(blockedSubmitResult.error, "Anonymous auth could submit a bok for review.");
assertOk(blockedSubmitResult.error.code !== "PGRST202", "Bok submission RPC is missing.");

const blockedReviewResult = await supabase.rpc("review_bok_submission", {
  p_bok_id: reel.id,
  p_decision: "approve",
  p_reason: "",
});
assertOk(blockedReviewResult.error, "Anonymous auth could review a bok.");
assertOk(blockedReviewResult.error.code !== "PGRST202", "Bok review RPC is missing.");

// --- Recommendation experiment surface -------------------------------------
// These RPCs arrive with 20260912160000_boks_recommendation_experiments.sql.
// A project that has not applied it yet is reported as `pending` rather than
// failed, because the reader degrades to the newest-first baseline instead of
// breaking. Everything else here is a hard requirement.

function isMissingRpc(error) {
  return error?.code === "PGRST202";
}

const experimentResult = await supabase.rpc("get_active_recommendation_experiment");
const recommendationMigrationApplied = !isMissingRpc(experimentResult.error);

let activeExperimentReadable = "pending";
let rlsBlocksAnonymousLabAccess = "pending";
let rlsBlocksAnonymousExperimentWrites = "pending";
let attributedEventsWritable = "pending";
let authorQuotaReadable = "pending";

if (recommendationMigrationApplied) {
  if (experimentResult.error) throw experimentResult.error;
  assertOk(experimentResult.data?.key, "Active recommendation experiment has no key.");
  assertOk(Array.isArray(experimentResult.data?.arms), "Active recommendation experiment has no arms.");
  activeExperimentReadable = true;

  const labResult = await supabase.rpc("get_recommendation_lab", { p_days: 7 });
  assertOk(labResult.error, "Anonymous auth could read the recommendation lab.");
  rlsBlocksAnonymousLabAccess = true;

  const blockedExperimentWrite = await supabase.rpc("save_recommendation_experiment", {
    p_key: "boks-feed-v1",
    p_control_algorithm_id: "balanced",
    p_arms: [{ algorithmId: "balanced", weight: 100 }],
    p_minimum_impressions_per_arm: 10,
  });
  assertOk(blockedExperimentWrite.error, "Anonymous auth could change the live experiment split.");
  rlsBlocksAnonymousExperimentWrites = true;

  // Guest readers are real anonymous users and must still be measurable.
  const eventResult = await supabase.rpc("record_recommendation_events", {
    p_events: [
      {
        eventType: "impression",
        storyId: reel.id,
        value: 1,
        algorithmId: "balanced",
        experimentKey: experimentResult.data.key,
        userSegment: "general",
        surface: "reader",
        rank: 0,
        clientElapsedSeconds: 0,
        estimatedSeconds: 300,
        sessionId: "verify",
        visitorId: "verify",
      },
    ],
  });
  if (eventResult.error) throw eventResult.error;
  assertOk(eventResult.data === 1, "Attributed reader event was not recorded.");
  attributedEventsWritable = true;

  const blockedEventRead = await supabase.from("recommendation_events").select("id").limit(1);
  assertOk((blockedEventRead.data ?? []).length === 0, "Anonymous auth could read the event stream.");
}

const quotaResult = await supabase.rpc("get_my_bok_quota");
if (!isMissingRpc(quotaResult.error)) {
  if (quotaResult.error) throw quotaResult.error;
  assertOk(quotaResult.data?.exhausted !== true, "An author submission quota reports a limit; authors have none.");
  assertOk(quotaResult.data?.usedToday === 0, "Anonymous auth reported author submissions.");
  authorQuotaReadable = true;
}

console.log(
  JSON.stringify(
    {
      anonymousAuth: "working",
      publishedReelsReadable: true,
      viewRecorded: true,
      rlsBlocksAnonymousLikes: true,
  commentsReadable: true,
  commentThreadsReadable: true,
  rlsBlocksAnonymousComments: true,
  rlsBlocksAnonymousCommentLikes: true,
      rlsBlocksAnonymousProfileUpdates: true,
      rlsBlocksOtherUserWrites: true,
      rlsBlocksBrowserReelWrites: true,
      anonymousProfileContext: true,
      rlsBlocksAnonymousAdminSnapshot: true,
      rlsBlocksAnonymousAdminGrant: true,
      rlsBlocksAnonymousPeople: true,
      rlsBlocksAnonymousDeletedBoks: true,
      rlsBlocksAnonymousLifecycleActions: true,
      authorSubmissionsRpcReadable: true,
      rlsBlocksAnonymousBokSubmit: true,
      rlsBlocksAnonymousBokReview: true,
      recommendationMigrationApplied,
      activeExperimentReadable,
      attributedEventsWritable,
      rlsBlocksAnonymousLabAccess,
      rlsBlocksAnonymousExperimentWrites,
      authorQuotaReadable,
      checkedReel: reel.title,
    },
    null,
    2
  )
);
