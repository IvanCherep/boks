# Domain docs

boks is a **single-context** repo: one `CONTEXT.md` at the root and ADRs in `docs/adr/`.

## Before exploring, read these

- **`CONTEXT.md`**: the glossary. Use its terms in issue titles, test names, commit messages and new identifiers. Its "Legacy names in code" table maps the names that predate it (`reels`, `Story`, `storyId`) - keep those in existing code, use the glossary term in new code.
- **`docs/adr/`**: the decisions that touch the area you are about to change. Number new ones `NNNN-slug.md`, one higher than the last; a paragraph is enough.
- **`docs/project-state.md`**: what is live and what is deliberately unfinished.

## Use the glossary's vocabulary

When your output names a domain concept, use the `CONTEXT.md` term, not a synonym it lists under _Avoid_. A concept the glossary lacks is either invented language (reconsider) or a real gap (add the term with the change that needs it).

## Flag ADR conflicts

If your change contradicts an ADR, say so explicitly and either write a superseding ADR or stop and ask:

> _Contradicts 0008 (for_you is the single live arm), but worth reopening because…_
