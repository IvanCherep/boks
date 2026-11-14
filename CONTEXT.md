# boks

boks is a swipe-first feed of complete short literature, each piece readable in a 15-minute break, built to compare recommendation algorithms by measured reading behaviour.

## Language

### Content

**Bok** (plural **boks**):
One complete short literary work - a story, a poem or a self-contained fragment - that fits the 15-minute promise.
_Avoid_: reel, story, piece, item, post, fragment

**boks**:
The product's name, and the plural of bok. Never the singular.
_Avoid_: "a boks"

**Byline**:
The author name printed on one bok, chosen when it is published; it does not follow later changes to the account.
_Avoid_: display name, pen name, author name

**Page name**:
The optional name (at most 60 characters) and photo an author sets for their own page (`/@handle`) in the cabinet; they title that page and its link preview only. Comments keep the @handle and every bok keeps its byline (`author_pages`, 20261110100000).
_Avoid_: display name, profile name

**Author space**:
The stable identity of one author page, independent of an account: a living author's page prepared in Studio and handed over by an **invitation** (then owned by their account), or an **editorial page** the team runs for a classic (`/@pushkin`), with its own @handle and followers. Holds **prepared works**, each a new text or a text / Series version attached to an existing bok, with a revision that a publication confirms (`author_spaces`, 20261114100000).
_Avoid_: draft profile, shadow account, pseudo-user

**Editorial page**:
An author space of kind `editorial`: a classic's page the team prepares and publishes from Studio, recording the basis of the rights and the source of the texts. Readers follow it as a page; nobody signs in as the classic.
_Avoid_: classic account, publisher writer page

**Catalogue**:
Every published bok the feed may draw from.
_Avoid_: catalog, library, inventory

**Publisher account**:
An account that owns imported catalogue boks, each carrying its own byline.
_Avoid_: import user, system author

**Link-only piece**:
A living author's work produced in a boks format and reachable only by its own link, before any agreement to publish; not a bok and not in the catalogue (`docs/link-only-pieces.md`).
_Avoid_: unlisted bok, private bok, hidden bok

**Submission**:
A bok an author has sent for review and an admin has not yet approved or refused.
_Avoid_: draft, upload

**Summary**:
One or two editorial sentences on a bok's cover saying what it is and why to read it, in the text's own language.
_Avoid_: hook (the retired author-written opener), description, blurb, annotation

**Archived bok**:
A bok hidden from readers by an admin with a recorded reason; it can be restored. Shown as "Deleted" in the console.
_Avoid_: deleted bok (except for permanent erasure)

**Withdrawn bok**:
A bok its own author took off review or off the feed (status `withdrawn`). Only the author returns, edits or deletes it; an admin removal is an archived bok, and neither side undoes the other's.
_Avoid_: hidden, unpublished, archived (that is the admin's)

### People

**Reader**:
Anyone reading the feed, with or without an account.
_Avoid_: user, visitor, viewer, person

**Guest**:
A reader without an account, allowed 15 boks before being asked to sign up.
_Avoid_: anonymous user, visitor

**Account**:
A permanent, email-verified identity that can like, comment, follow and publish.
_Avoid_: profile, member, user

**Handle**:
An account's unique public `@name`, the only way a person is identified anywhere in the product.
_Avoid_: nickname, username, display name

**Author**:
An account that publishes boks.
_Avoid_: writer, creator

**Admin**:
An account holding the admin role, granted only from the admin console.
_Avoid_: founder, operator, moderator

**Visitor id**:
The random id a browser keeps so one device's behaviour can be grouped before and across sign-up.
_Avoid_: browser id, device id, reader id, guest id

**Session**:
One continuous visit, identified by a session id.
_Avoid_: visit

**Tracked link**:
A link an admin makes in the console for one place boks is sent to, usually opening one bok, whose code (`?link=`) lets the console say what that link brought.
_Avoid_: campaign, referral link, utm link

**Team device**:
A visitor id belonging to the people who build boks, left out of guest numbers.
_Avoid_: internal user, test device

### Reading

**Feed**:
The single algorithmic, swipe-first stream of boks at `/`.
_Avoid_: timeline, home, stream

**Slate**:
The ordered list of boks one feed request serves.
_Avoid_: page, batch, results

**Served feed**:
The stored record of one slate and the inputs that produced it, kept so the ranking can be replayed.
_Avoid_: feed log, provenance row

**Read**:
A bok judged finished from foreground reading time and scroll progress; there is no "finished" button. The event is named `complete`.
_Avoid_: finish, completion

**Shown**:
A bok that was on the reader's screen in an earlier visit; the feed serves every unshown bok before any shown one.
_Avoid_: seen (in prose), viewed

**Skip**:
Leaving a bok before it could plausibly have been read.
_Avoid_: drop, bounce

**Reading time**:
Foreground time with the bok on screen; a locked phone does not read.
_Avoid_: dwell, time on page

**Aftertaste**:
The optional words a reader picks for what a bok left them with.
_Avoid_: rating, reaction, mood

**Reading languages**:
The languages a reader has chosen to be offered; an undetermined language is not a yes.
_Avoid_: locale, language filter

**Interface language**:
The language of buttons and notices - Russian on a Russian device, English otherwise, or the reader's pinned choice. Never the language of a text.
_Avoid_: locale, reading language

### Recommendation and experiments

**Algorithm**:
One registered way of ordering candidates into a slate, named by its algorithm id.
_Avoid_: ranker, model, variant (and "strategy" outside the code contract)

**Candidate**:
A bok eligible for a reader's next slate.
_Avoid_: item, pool entry

**Experiment**:
The live traffic split that assigns readers to algorithms.
_Avoid_: test, A/B

**Arm**:
One algorithm's share of an experiment.
_Avoid_: variant, bucket, group

**Control**:
The arm every other arm is compared against.
_Avoid_: baseline, default

**Assignment**:
A reader's stable, deterministic placement in an arm.
_Avoid_: allocation, bucketing

**Segment**:
A stable reader grouping used to slice comparisons.
_Avoid_: cohort

**Reader event**:
One attributed behavioural fact - impression, start, complete, skip, like, share, comment, heartbeat, aftertaste.
_Avoid_: signal, log, hit

**Metric**:
A count or a rate measured from reader events; never an invented composite.
_Avoid_: score, KPI

**Signal**:
A normalised 0..1 feature of a candidate that an algorithm scores against; a ranking input, not a metric.
_Avoid_: metric, feature flag

**Study**:
One of the controlled tests behind the thesis hypotheses (РГ1, РГ2, А1, А2, Б1, Б2, Б3), run at `/study/<key>` and switched on and off in Studio. Distinct from the experiment, which splits the live feed between algorithms.
_Avoid_: survey, test, experiment (that is the feed split)

**Participant**:
A person enrolled in one study, with the condition the server assigned and the seed of their plan.
_Avoid_: respondent, subject, user

**Condition**:
What a participant's study varies for them - Series or text, feed or catalogue, active or passive.
_Avoid_: arm (that is the experiment's), group, variant

**Successful session**:
In studies РГ2 and А2: within the session a new text was read to the end, by measurement and by the participant's own answer, and the choice was rated 4 or 5 of 5.
_Avoid_: удачная находка outside the thesis text

### Reading formats

**Reading format**:
A way of presenting a bok other than plain text: cinema or immersive poem.
_Avoid_: production, mode, experience

**Cinema**:
A prose bok read aloud over illustrated scenes, paused by story moments.
_Avoid_: cinema mode, video

**Immersive poem**:
A verse bok whose words arrive inside the picture as they are spoken.
_Avoid_: poetry mode, poem player

**Scene gesture**:
Something a poem's picture does under the reader's hand while the voice goes on - holding stills the water, moving sideways leans the landscape. It never stops the reading.
_Avoid_: moment, interaction (for this), effect

**Story moment**:
A point where a cinema bok stops and asks the reader for a gesture.
_Avoid_: interaction, effect, interactive scene

**Series piece**:
A bok that also exists in a reading format.
_Avoid_: production, series item

**Series shelf**:
The `/series` tab listing series pieces - the only shelf in the product.
_Avoid_: library, series page

## Legacy names in code

Names that predate this glossary and stay for compatibility (see `docs/adr/0007-keep-the-reels-table-name.md`). New code uses the glossary term.

| In code | Means |
|---|---|
| `reels` table, `reel_id`, `p_reel_id`, `reelId` | Bok |
| `Story`, `storyId`, `stories` (browser types, event payload) | Bok |
| `author_name` / `authorName` | Byline |
| `p_display_name`, `displayName` in some RPC results | Handle (the argument is accepted and ignored) |
| `visitor_handle`, `visitorName` on comments | Handle |
| `strategy`, `strategies/` | Algorithm (the code contract one algorithm implements) |
| status `archived` / `rejected` | Archived bok / refused submission |
