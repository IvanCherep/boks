# 0014: `CONTEXT.md` for language, a short `AGENTS.md` for rules

Date: 2026-10-05
Status: accepted (supersedes 0004)

Agent onboarding had grown into five overlapping documents - a 19 KB `AGENTS.md`, `docs/ai-agent-guide.md`, `docs/future-updates-playbook.md`, the naming section of `docs/engineering-standards.md` and the read order in `docs/README.md` - with three read orders, three validation lists and four partial glossaries that disagreed (bok/boks/reel/story, handle/nickname/display name). Now:

- `CONTEXT.md` is the one glossary: terms only, no implementation.
- `AGENTS.md` (imported by `CLAUDE.md`) is a short entry point: product promise, the rules an agent must not break, commands, and pointers.
- `docs/architecture.md` holds the module map and data flows.
- Decisions are ADRs in `docs/adr/NNNN-slug.md`; the old `docs/decisions/` folder is gone.
- Work is tracked in GitHub Issues (`docs/agents/issue-tracker.md`); `docs/handover/` stays as per-session logs.
