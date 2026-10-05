# 0008: `for_you` is the control, and the only live arm for now

Date: 2026-09-20
Status: accepted

`for_you` is the product ranker, so it is the control every other algorithm is compared against (`controlAlgorithmId` in `lib/boks/recommendations/registry.ts`). Since the launch it also takes 100% of traffic: at a few dozen readers a split leaves each arm too small to detect even a large difference, and costs half the audience a worse feed. Other algorithms stay registered at weight 0. The full reasoning, and the pairing to reopen with (`for_you` against `completion_first`, chosen by `npm run verify:divergence`), is in the comment on `defaultExperimentConfig` in `lib/boks/recommendations/experiments.ts`.

## Consequences

Reopening a comparison is a data change in `/admin` (raise a weight), not a deploy. Until then the lab's comparisons are empty by design.
