# 0007: Keep the `reels` table name

Date: 2026-09-10 (recorded 2026-10-05)
Status: accepted

The content unit is a **bok** (see `CONTEXT.md`), but its table is still `public.reels` with `reel_id` foreign keys, and the browser type is `Story` with `storyId`. Renaming would touch every migration-defined function, RLS policy, view and the JSON contract shared with open browser tabs, in a production database that has no downtime window - for no behavioural gain. New code and new SQL objects use *bok*; the legacy names are listed in `CONTEXT.md` under "Legacy names in code" and stay as they are.
