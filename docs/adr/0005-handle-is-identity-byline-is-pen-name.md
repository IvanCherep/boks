# 0005: The handle is the identity; the byline is a pen name

Date: 2026-09-15
Status: accepted

One column, `user_profiles.display_name`, used to mean both *who a person is* and *what name goes on a piece of work*. Migration `20260915100000_boks_handle_is_identity.sql` split them: the account's unique `@handle` is the only public identity of a person (comments, People, the account panel), and each bok carries its own **byline** in `reels.author_name`, chosen when publishing and deliberately allowed to differ from piece to piece. `display_name` was dropped; RPCs keep accepting a `p_display_name` argument and ignore it, so tabs opened before the change still work.

## Consequences

- Sign-up asks for an email only; the handle is derived from it and can be changed later.
- A byline never follows a later handle change - it is authored input, not a snapshot of the profile.
- Author diversity in ranking keys on the byline first, the account second (`authorIdentityKey`), because one publisher account carries many writers.
