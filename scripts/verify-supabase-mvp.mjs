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
if (likeResult.error) throw likeResult.error;

const unlikeResult = await supabase.from("likes").delete().eq("user_id", userId).eq("reel_id", reel.id);
if (unlikeResult.error) throw unlikeResult.error;

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

const adminSnapshotResult = await supabase.rpc("get_boks_admin_snapshot", {
  p_limit: 10,
  p_offset: 0,
  p_query: "",
  p_sort: "signal",
});
if (adminSnapshotResult.error) throw adminSnapshotResult.error;
assertOk(adminSnapshotResult.data?.funnel?.totalStories >= 1, "Admin snapshot did not return funnel metrics.");

console.log(
  JSON.stringify(
    {
      anonymousAuth: "working",
      publishedReelsReadable: true,
      viewRecorded: true,
      likeCreatedAndDeleted: true,
      rlsBlocksOtherUserWrites: true,
      rlsBlocksBrowserReelWrites: true,
      adminSnapshotReadable: true,
      checkedReel: reel.title,
    },
    null,
    2
  )
);
