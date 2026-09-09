# boks Product Spec

## Purpose

boks tests whether readers want a dedicated literature feed for complete short stories or book fragments that fit inside a 15 minute break. The prototype must support three jobs:

- readers discover, read, react, comment, and share;
- authors publish a short story without an admin panel;
- the founder reviews behavioral metrics from real test sessions.

## Current Prototype Scope

- Mobile-first responsive web app for MacBook, iPhone, and Android browsers.
- Three modes: Read, Author, Metrics.
- Shared D1 database for stories, comments, and analytics events.
- Seed stories for immediate demos plus author-created stories.
- Simple recommendation ranking based on selected mood, reading length, engagement, and completion.
- JSON metric export for analysis or investor updates.

## Validation Questions

- Do readers start stories when the promise is under 15 minutes?
- Do they complete after starting?
- Do they react or comment after completion?
- Which mood and genre combinations perform best?
- Do authors understand the 15 minute constraint and submit suitable pieces?

## MVP Extension Points

- Authentication: bind author identity to Sign in with ChatGPT or a later custom account system.
- Recommendation: replace client ranking with a server-side model using reader history and story embeddings.
- Content safety: add moderation before public publishing.
- Growth loops: add public story detail pages and richer share previews.
- Monetization: add author subscriptions, paid collections, or sponsor-supported free reading.
