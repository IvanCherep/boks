# boks Documentation Index

Start here when operating, testing, or changing boks.

## Read Order

For every AI coding assistant:

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/ai-agent-guide.md`
4. `specs/boks-product-spec.md`
5. The focused guide for the change: hosting, testing, standards, architecture, or growth

For founder/operator work:

1. `docs/hosting.md`
2. `docs/testing.md`
3. `docs/boks-operations.md`
4. `docs/growth-readiness.md`

For recommendation or metrics work:

1. `specs/boks-recommendation-experiments.md`
2. `docs/architecture.md`
3. `docs/engineering-standards.md`
4. `docs/architecture-review.md`

## Documents

- `docs/hosting.md`: how the production Cloudflare Worker is hosted, deployed, and checked.
- `docs/testing.md`: how to run reader tests, author tests, admin checks, and technical verification.
- `docs/ai-agent-guide.md`: fast onboarding, ownership map, spec-driven workflow, validation, and deployment rules for any AI agent.
- `docs/engineering-standards.md`: product values, naming, boundaries, code standards, and AI-agent workflow.
- `docs/architecture.md`: current module map and data flows.
- `docs/architecture-review.md`: current architecture assessment, risks, and next refactor steps.
- `docs/decisions/`: architecture decision records for future rewrites.
- `docs/boks-operations.md`: practical operator guide for interviews, metrics, and maintenance.
- `docs/future-updates-playbook.md`: repeatable workflow for future app changes.
- `docs/growth-readiness.md`: scale posture for 40,000 texts and the next growth moves.
- `specs/boks-product-spec.md`: product scope and validation questions.
- `specs/boks-recommendation-experiments.md`: recommendation algorithms, metrics, and experiment rules.

## Current Production URL

Use this URL for testers:

`https://read.tryboks.workers.dev`

Do not share old Worker URLs. Older Workers may exist as rollback backups, but their public `workers.dev` routes should remain disabled.
