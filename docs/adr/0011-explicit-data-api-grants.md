# 0011: Every Data API grant is explicit

Date: 2026-09-25
Status: accepted

Supabase's default grants on new objects in `public` had made a view (`boks_public_identity`) writable by `anon`, and Supabase stops granting new tables automatically from 30 October 2026. Migration `20260925100000_boks_data_api_grants.sql` revoked everything `anon` and `authenticated` held in `public` and granted back only what the app uses. From then on a migration that creates a table or view the Data API must reach grants it in the same migration, and `scripts/local-supabase/checks.sql` asserts the whole grant matrix.

## Consequences

- Prefer a `security definer` function with its own checks over a table grant.
- Never grant a write on a view: a view without `security_invoker` runs as its owner and bypasses RLS.
