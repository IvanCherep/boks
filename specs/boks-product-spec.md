# boks Product Spec

## Purpose

boks tests whether readers want a dedicated literature feed for complete short stories or book fragments that fit inside a 15 minute break. The prototype must support three jobs:

- readers discover, read, react, comment, and share;
- authors publish a short story without an admin panel;
- the founder reviews behavioral metrics from real test sessions.

## Current Prototype Scope

- Mobile-first responsive web app for MacBook, iPhone, and Android browsers.
- Dedicated routes: `/` for the swipe-first reader, `/author` for publishing, `/admin` for business analysis.
- Reader focus mode: the full interface appears briefly on a new story, then fades during reading so the story owns the screen. Tapping/clicking the reading surface reveals reactions and comments.
- Shared D1 database for stories, comments, and analytics events.
- Seed stories for immediate demos plus author-created stories.
- Server-side recommendation ranking with deterministic anonymous experiment assignment.
- Algorithm comparison metrics for start rate, finish rate, reaction rate, skip rate, read time, like timing, comment timing, feed rank, pace, and engagement score.
- JSON metric export for analysis or investor updates.

## Validation Questions

- Do readers start stories when the promise is under 15 minutes?
- Do they complete after starting?
- Do they react or comment after completion?
- Which mood and genre combinations perform best?
- Do authors understand the 15 minute constraint and submit suitable pieces?
- Does hiding manual choice improve story starts compared with chooser-based browsing?

## MVP Extension Points

- Authentication: bind author identity to Sign in with ChatGPT or a later custom account system.
- Recommendation: extend the algorithm registry, add precomputed rollups, then introduce reader history and story embeddings.
- Content safety: add moderation before public publishing.
- Growth loops: add public story detail pages and richer share previews.
- Monetization: add author subscriptions, paid collections, or sponsor-supported free reading.
- Operations: add pagination, moderation queues, cohort exports, and author-level reporting once inventory reaches thousands of texts.
