# boks Documentation Index

The read order is in `AGENTS.md`: `CONTEXT.md` → `docs/project-state.md` → this index → the focused doc. This page says which document owns which topic, so a fact lives in one place.

## Standing documents

| Topic | Document |
|---|---|
| Glossary - the words to use | `CONTEXT.md` |
| What is live, unfinished, known broken | `docs/project-state.md` |
| Module map and data flows | `docs/architecture.md` |
| Why the system is shaped this way | `docs/adr/` (`NNNN-slug.md`) |
| Product scope and rules | `specs/boks-product-spec.md` |
| Algorithms, signals, metrics, experiments | `specs/boks-recommendation-experiments.md` |
| Every number in `/admin` and the decision it supports | `docs/admin-metrics.md` - read before adding a metric |
| Code standards, boundaries, UI and data standards | `docs/engineering-standards.md` |
| Architecture risks and the next refactors | `docs/architecture-review.md` |
| Trust boundaries, controls, Advisor exceptions | `docs/security.md` - read before auth, grants, API or database-boundary work |
| New developer: access, tools, env files, first checks | `docs/onboarding.md` |
| Running boks locally, and the env-file traps | `docs/local-environment-runbook.md` |
| Services and credentials an agent may touch (Cloudflare, Supabase, Resend) | `docs/local-agent-infrastructure.md` |
| Hosting, deploy, post-deploy checks, rollback, plan costs | `docs/hosting.md` |
| Test layers and manual QA scripts | `docs/testing.md` |
| Running a user test, operator routine | `docs/boks-operations.md` |
| Scale limits and the next growth moves | `docs/growth-readiness.md` |
| Issue tracker and domain-doc conventions for agents | `docs/agents/` |

## Topic guides

- `docs/reading-formats.md`: the cinema and immersive-poem formats and the series shelf - routing a piece to a format, the cast, image specs and prompts, the story-moment effects, manifests, the properties never to animate, audio levels. The whole process for adding a series piece. Source material for poems lives in `docs/poetry/<slug>/`.
- `docs/media-generation.md`: generating any audio - the key and scopes, what each failure code means, endpoint costs, the credit-multiplier and licensing traps, choosing takes by measurement.
- `docs/catalogue-import.md`: loading a catalogue - the publisher-account model, the file format, the admin panel, test batches.
- `docs/copyright.md`: rights attestation on publishing, the per-bok report menu, handling a complaint.
- `docs/public-domain-corpus.md`, `docs/russian-corpus.md`: where the English and Russian texts come from, why they are free to publish, how the converters work and what they got wrong first.
- `docs/reading-languages.md`: which language a reader is offered, why the filter lives in retrieval, why an undetermined language is not a yes.
- `docs/analytics-and-thesis-readiness.md`: what the analytics can and cannot prove, claim by claim, and the ranked gaps.
- `docs/research/`: the recommender system report and the phased research implementation plan.
- `docs/ai-context.md`: a one-page Russian briefing to paste into an AI chat that has no repo access. A dated snapshot derived from the documents above - when they disagree, they win; refresh it after a large change.
- `docs/thesis/`: исследовательская часть магистерской работы (ВКРС). Начинать с `docs/thesis/README.md`.

## Picking up work

- The backlog is GitHub Issues (`docs/agents/issue-tracker.md`).
- `docs/handover/` holds per-session logs: what one session did, verified and deliberately left. Read the newest one when continuing in-flight work.
- `docs/project-state.md` is the standing summary - update it when something ships.

## Production

`https://tryboks.com` is the only address to share. Older Workers may exist as rollback references; their `workers.dev` routes stay disabled, and `read.tryboks.workers.dev` redirects to the apex (`docs/adr/0010-apex-only-origin.md`).
