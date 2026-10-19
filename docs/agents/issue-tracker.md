# Issue tracker: GitHub

Issues and specs for boks live in GitHub Issues on **`IvanCherep/boks`**. Always pass `-R IvanCherep/boks` to `gh`: remote names vary by checkout. Check `git remote -v` before Git operations; the current local checkout uses `origin` directly for GitHub, while older checkouts used a separate `github` remote and a mirror as `origin`.

## Conventions

- **Create**: `gh issue create -R IvanCherep/boks --title "..." --body "..."` (heredoc for multi-line bodies). Titles may be Russian or English; use `CONTEXT.md` terms either way.
- **Read**: `gh issue view <n> -R IvanCherep/boks --comments`
- **List**: `gh issue list -R IvanCherep/boks --state open --json number,title,body,labels,comments`
- **Comment**: `gh issue comment <n> -R IvanCherep/boks --body "..."`
- **Labels**: `gh issue edit <n> -R IvanCherep/boks --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <n> -R IvanCherep/boks --comment "..."` - and close it in the same change that fixes it; a commit that says `#5` does not close #5 on its own.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Where work is recorded

- **Backlog and specs**: GitHub Issues. Items still listed under "Queued work" and "Known open issues" in `docs/project-state.md` should move into issues as they are picked up.
- **What a session did**: `docs/handover/YYYY-MM-DD-<topic>.md`, linked from the issue it served.
- **What is true now**: `docs/project-state.md`.
- **Why something is the way it is**: `docs/adr/`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue on `IvanCherep/boks`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <n> -R IvanCherep/boks --comments`.
