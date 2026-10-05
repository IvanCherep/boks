# 0004: Maintain Agent-Readable Documentation

Date: 2026-09-12
Status: superseded by 0014 - `docs/ai-agent-guide.md` was folded into `AGENTS.md`, `CONTEXT.md` and `docs/architecture.md`.

## Context

boks is being developed through fast MVP iteration with AI coding assistants. Different agents may work on the project over time, including Codex, Claude, Cursor, and other tools. Without a stable onboarding map, agents can spend too much time rediscovering product rules, choosing the wrong files, or making changes that violate the core feed concept.

The project already has specs, architecture notes, hosting notes, and an `AGENTS.md` file. The missing piece was a single practical guide that ties product invariants, file ownership, spec-driven workflow, validation, and deployment together.

## Decision

Maintain `docs/ai-agent-guide.md` as the cross-agent onboarding document.

Every future agent should read:

- `AGENTS.md`
- `docs/README.md`
- `docs/ai-agent-guide.md`
- the relevant spec in `specs/`
- the focused guide for the task

When product behavior, file ownership, validation, deployment, or data boundaries change, update the agent guide with the same task.

## Consequences

Agents can gather context faster and make smaller, safer changes.

The documentation becomes part of the architecture. If docs drift, future agents may make wrong assumptions even when the code is correct. Keeping `docs/ai-agent-guide.md`, `AGENTS.md`, specs, and architecture notes synchronized is now part of the definition of done.
