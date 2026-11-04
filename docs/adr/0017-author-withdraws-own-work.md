# 0017: An author withdraws their own work with its own status

Date: 2026-11-04
Status: accepted.

Authors need to take a piece off review or off the feed themselves - a wrong file in a batch upload, a change of mind, a published piece they no longer want shown. Until now only an admin could, with `archive_bok`.

The author's action is a separate status, `withdrawn`, not the admin's `archived`:

- **Neither side undoes the other.** An admin removal is a decision about the author (rights, rules); the author must not be able to put it back. An author's withdrawal is the author's own; `restore_archived_bok` must never republish it, so an admin restore of a withdrawn-then-archived piece returns it to `withdrawn`.
- **No reader path changes.** Every reader surface reads `status = 'published'` only (feed candidates, `published_boks`, profiles, series, libraries, comment policies), so a new status is invisible there by construction. Reusing `archived` with an "archived by author" flag would have needed every admin list and restore path to learn the difference.
- **Returning a published piece skips review.** Its text did not change; making the author wait for a second approval would punish them for hiding it. Editing a withdrawn piece goes through `submit_bok_for_review` and back to review, like a refused one. A piece whose rights record was withdrawn returns to review instead.
- **Deleting for good** is the author's only from `withdrawn` and needs the exact title, like the admin's permanent delete. It cascades to likes, comments and reading history.

Trade-off: the admin console does not list withdrawn pieces in Moderation or Content; an admin finds one through the bok inspector, where it reads "Withdrawn by the author".
