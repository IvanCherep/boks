# boks Documentation Index

Start here when operating, testing, or changing boks.

## Read Order

For every AI coding assistant:

1. `AGENTS.md`
2. `docs/project-state.md` - what is live, what is not, and what is deliberately unfinished
3. `docs/local-environment-runbook.md` - before running anything locally
4. `docs/ai-agent-guide.md`
5. `docs/local-agent-infrastructure.md` when the agent needs to deploy or manage services
6. `specs/boks-product-spec.md`
7. The focused guide for the change: hosting, testing, standards, architecture, or growth

For authentication, authorization, dependency, API, or database-boundary work,
read `docs/security.md` before editing.

For founder/operator work:

1. `docs/admin-metrics.md`
2. `docs/hosting.md`
3. `docs/testing.md`
4. `docs/boks-operations.md`
5. `docs/growth-readiness.md`

For recommendation or metrics work:

1. `RECSYS-SYSTEM-REPORT.md` - the whole system in one place: signals, strategies, instrumentation, statistics, what was wrong and how it was fixed, and the measured state
2. `RECSYS-RESEARCH-IMPLEMENTATION-PLAN.md` - the phased plan, sections A-N. Phase 1 is done; 2-7 are not
3. `docs/adr/ADR-001-where-ranking-executes.md`
4. `specs/boks-recommendation-experiments.md`
5. `docs/architecture.md`, `docs/engineering-standards.md`, `docs/architecture-review.md`

To pick up unfinished work, read `docs/project-state.md`, then the newest file
in `docs/handover/`. A handover records what one session did, what it verified,
and what it deliberately left; `project-state.md` is the standing summary, so it
is the one to update when something ships.

## Documents

- `docs/project-state.md`: what is live, what is not in production yet, the state of the recommender, the identity model, and the known open issues. Start here in a new session.
- `docs/local-environment-runbook.md`: getting a working local boks - which env file points where, the local mailbox, an admin account, and the migration/schema-cache traps that cost the most time.
- `docs/catalogue-import.md`: loading a catalogue - the publisher-account model, the file format, the admin panel, and how to generate and remove test batches. Read it before putting content on the platform in bulk.
- `docs/copyright.md`: the rights attestation on publishing, the per-bok report menu, and what an admin can do about a complaint. Read it before touching publishing or the reader's bok menu.
- `docs/public-domain-corpus.md`: the 457 real pieces on the platform - where they come from, why they are free to publish, how the splitter works and what it got wrong first.
- `docs/thesis/`: исследовательская часть магистерской работы в формате ВКРС - словарь терминов, вводные с замеренными цифрами, карта литературы, дерево гипотез, карточки отобранных гипотез с дизайном эксперимента, линейка baseline, питч-дек и каркасы отчётов. Начинать с `docs/thesis/README.md`.
- `docs/russian-corpus.md`: the 449 Russian pieces - why Wikisource rather than Gutenberg, the copyright bar and why it is stricter than the English one, how the converter gets literature out from under the wiki's apparatus, and the three product defects the corpus exposed.
- `docs/reading-languages.md`: which language a reader is offered and why - the browser-derived default, the mandatory setting, why the filter lives in retrieval, and why an undetermined language is not a yes. Read it before touching retrieval or the account panel.
- `docs/analytics-and-thesis-readiness.md`: what the analytics can and cannot prove, claim by claim against the thesis title, the working loop for a comparison, and the ranked gaps.
- `docs/admin-metrics.md`: every field in `/admin`, what it is computed from, and the decision it supports. Read this before adding a metric.
- `specs/boks-product-spec.md`: admin account and content lifecycle rules, including reversible boks deletion, suspension, role changes, and permanent deletion safeguards.
- `docs/hosting.md`: how the production Cloudflare Worker is hosted, deployed, and checked.
- `docs/security.md`: trust boundaries, implemented controls, release checks, Advisor exceptions, and residual risks.
- `docs/local-agent-infrastructure.md`: infrastructure and deployment handoff for local agents such as Claude, Cursor, or Codex CLI.
- `docs/testing.md`: how to run reader tests, author tests, admin checks, and technical verification.
- `docs/ai-agent-guide.md`: fast onboarding, ownership map, spec-driven workflow, validation, and deployment rules for any AI agent.
- `docs/engineering-standards.md`: product values, naming, boundaries, code standards, and AI-agent workflow.
- `docs/architecture.md`: current module map and data flows.
- `docs/architecture-review.md`: current architecture assessment, risks, and next refactor steps.
- `docs/decisions/`: architecture decision records for future rewrites.
- `docs/handover/`: per-session work records for agents picking up in-flight work.
- `docs/boks-operations.md`: practical operator guide for interviews, metrics, and maintenance.
- `docs/future-updates-playbook.md`: repeatable workflow for future app changes.
- `docs/growth-readiness.md`: scale posture for 40,000 texts and the next growth moves.
- `specs/boks-product-spec.md`: product scope and validation questions.
- `specs/boks-recommendation-experiments.md`: recommendation algorithms, metrics, and experiment rules.

## Current Production URL

Use this URL for testers:

`https://tryboks.com`

Do not share old Worker URLs. Older Workers may exist as rollback backups, but their public `workers.dev` routes should remain disabled.
