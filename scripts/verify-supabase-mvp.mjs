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

const viewResult = await supabase.from("views").insert({
  user_id: userId,
  reel_id: reel.id,
});
if (viewResult.error) throw viewResult.error;

const likeResult = await supabase.from("likes").upsert(
  {
    user_id: userId,
    reel_id: reel.id,
  },
  { onConflict: "user_id,reel_id" }
);
assertOk(likeResult.error, "Anonymous auth could like a bok.");

const commentsResult = await supabase
  .from("comments")
  .select("id,reel_id,visitor_name,visitor_handle,body,created_at")
  .eq("reel_id", reel.id);
if (commentsResult.error) throw commentsResult.error;

const blockedCommentResult = await supabase.rpc("create_bok_comment", {
  p_reel_id: reel.id,
  p_body: "Anonymous comments must be blocked.",
});
assertOk(blockedCommentResult.error, "Anonymous auth could comment on a bok.");
assertOk(blockedCommentResult.error.code !== "PGRST202", "Bok comment RPC is missing.");

const blockedProfileUpdateResult = await supabase.rpc("update_boks_user_profile", {
  p_display_name: "Anonymous check",
  p_handle: "anonymous_check",
});
assertOk(blockedProfileUpdateResult.error, "Anonymous auth could update a permanent profile.");
assertOk(blockedProfileUpdateResult.error.code !== "PGRST202", "Profile update RPC is missing.");

const otherUserId = "00000000-0000-4000-8000-000000000001";
const blockedViewResult = await supabase.from("views").insert({
  user_id: otherUserId,
  reel_id: reel.id,
});
assertOk(blockedViewResult.error, "RLS allowed inserting a view for another user.");

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

const authorSubmissionsResult = await supabase.rpc("get_my_bok_submissions", {
  p_limit: 10,
});
if (authorSubmissionsResult.error) throw authorSubmissionsResult.error;
assertOk(Array.isArray(authorSubmissionsResult.data), "Author submissions RPC did not return a list.");

const blockedSubmitResult = await supabase.rpc("submit_bok_for_review", {
  p_title: "Blocked anonymous submit",
  p_author_name: "Anonymous QA",
  p_author_handle: "@qa",
  p_hook: "This should not be accepted.",
  p_text: "Anonymous users must create a permanent account before submitting boks.",
  p_genre: "literary",
  p_mood: "quiet",
  p_minutes: 1,
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

console.log(
  JSON.stringify(
    {
      anonymousAuth: "working",
      publishedReelsReadable: true,
      viewRecorded: true,
      rlsBlocksAnonymousLikes: true,
      commentsReadable: true,
      rlsBlocksAnonymousComments: true,
      rlsBlocksAnonymousProfileUpdates: true,
      rlsBlocksOtherUserWrites: true,
      rlsBlocksBrowserReelWrites: true,
      anonymousProfileContext: true,
      rlsBlocksAnonymousAdminSnapshot: true,
      rlsBlocksAnonymousAdminGrant: true,
      authorSubmissionsRpcReadable: true,
      rlsBlocksAnonymousBokSubmit: true,
      rlsBlocksAnonymousBokReview: true,
      checkedReel: reel.title,
    },
    null,
    2
  )
);
