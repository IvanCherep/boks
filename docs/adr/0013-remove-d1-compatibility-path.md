# 0013: Remove the D1 compatibility path

Date: 2026-10-05
Status: accepted

The original prototype stored readers, boks and events in Cloudflare D1 behind `/api/boks`. After the move to Supabase (0003) and Worker-side ranking (0001) it was kept as a "compatibility path", but production could not reach it: `wrangler.jsonc` declares no `d1_databases` binding, so `/api/boks` served seed demo stories on GET and failed on every POST. Its only real effect was misleading agents and producing failed event posts. It was removed: `app/api/boks`, `db/`, `drizzle/`, `lib/boks/analytics.ts`, `lib/boks/request.ts`, `lib/boks/seed-stories.ts`, `examples/d1` and the Drizzle dependencies. Supabase is the only store; a build without `VITE_SUPABASE_*` shows an explicit not-configured state instead of falling back to a second store.
