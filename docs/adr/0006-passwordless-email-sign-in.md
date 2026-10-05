# 0006: Passwordless email sign-in - a magic link or a 6-digit code

Date: 2026-09-10, code added 2026-10-04
Status: accepted

Readers sign in with Supabase email OTP only: the email carries both a magic link and a 6-digit code (`verifyOtp` in `lib/boks/supabase-client.ts`). There are no passwords, no password reset and no change-password UI. The code exists because a link opened from the mail app cannot reach boks installed on an iPhone home screen - a different storage origin - while a typed code can. Both the *Magic Link* and the *Confirm signup* templates must carry `{{ .Token }}` (`scripts/set-magic-link-template.sh`), because a first sign-in receives the latter.

## Considered options

Passwords were rejected: they add reset flows, leaked-password handling and UI weight to a product whose promise is a quiet reading screen. OAuth providers were not needed for a pilot audience reached by email.
