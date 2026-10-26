# boks Admin Metrics Reference

Every number in `/admin`, what it is computed from, and which decision it
supports. If a field cannot answer the third column, it does not belong here.

Two rules govern the whole console:

1. **One source per concept.** Reader behaviour comes from
   `public.recommendation_events`. `views`, `likes` and `comments` are product
   features (reading history, like state, the comment thread) and are never used
   as behavioural metrics. Before this rule, the console showed `views` = 406 and
   impression events = 766 under the same word on the same screen.
2. **Counts over time; rates only beside their denominator.** A weekly count of
   readers or minutes is honest at any sample size. A weekly *rate* computed from
   a dozen readers moves several points when one person changes their mind, so
   rates appear only where the denominator is printed next to them, and finish
   rate per boks is withheld entirely below ten starts.

---

## This week

The operating page. One window, no trends.

| Field | Computed from | Decision it supports |
|---|---|---|
| Returning from the previous N days | readers active in both this window and the previous one, over the previous window | The single best predictor of survival. If this falls, nothing else matters. |
| Active readers · new | distinct `user_id` with reader events in the window | Scale of the sample everything else on the page is drawn from. |
| Sessions per reader | distinct `session_id` ÷ active readers | Whether reading is a habit or a one-off visit. |
| Minutes per reader | Σ max(`active_seconds`) per (session, boks) ÷ active readers | The north star, per person rather than in aggregate so it cannot be inflated by a single heavy week. |
| Minutes per session | minutes ÷ sessions | Decomposes the north star: did people visit more, or stay longer? |
| Boks finished · started | `complete` and `start` events, distinct per (session, boks) | Reading time without completions means people are stalling, not reading. |
| Active minutes per boks finished | all active minutes (finished, skipped and unfinished reads) ÷ completions | **Goodhart guard.** Minutes alone reward long boks and slow readers; this exposes that immediately. |
| Finished after starting | completions ÷ starts | Whether the feed is choosing boks people want to finish. |
| Reads per reader (distribution) | readers bucketed 1 / 2-4 / 5-9 / 10+ | The product thesis is "people read more than one". A mean hides the split between one-and-done and regulars, which *is* the question. |
| Published boks · added in 30 days | `reels` where `status = 'published'` | Supply. A feed starves before it mis-ranks. |
| Readers past half the catalog | readers whose distinct impressions exceed half the catalog | Churn risk, and the point at which ranking becomes meaningless because nothing is left to rank. |
| Submitted · approved · refused | `reels.submitted_at` / `reviewed_at` | Whether the supply side is alive. |
| Waiting for review · median review hours | `status = 'pending_review'`; median of `reviewed_at - submitted_at` | Author experience. A queue that sits for days loses authors. |
| Reads with a recorded outcome | (session, boks) pairs with an impression that also produced a completion or skip | **Trust check.** Was near zero before the terminal-read fix; if it drops again, every rate above is wrong. |
| Sessions ending with no outcome | sessions where no outcome was recorded at all | Same check from the session end. |
| Events with no algorithm | events with `algorithm_id = 'unassigned'` | Events that cannot enter any comparison. |
| Outcomes with no reading time | completions/skips with `active_seconds = 0` | The clock never started — a bug signature, not a reader behaviour. |

## Growth

The trajectory. Everything plotted weekly is a count or a total.

| Field | Computed from | Decision it supports |
|---|---|---|
| Readers all time · with accounts | distinct readers ever; `user_profiles` count | Absolute scale, and how much of it converted. |
| Minutes read all time · boks finished | Σ max(`active_seconds`); `complete` events | Cumulative value delivered. |
| Readers today / this week / this month | distinct readers in 1 / 7 / 30 days | Daily-over-monthly is the usual shorthand for habit. |
| New readers per week | first reader event bucketed by week | Is acquisition working, and is it accelerating. |
| Accounts created per week | `user_profiles.created_at` by week | Conversion from guest reading to a permanent account. |
| Minutes read per week | Σ max(`active_seconds`) by week | The north star as a trend rather than a snapshot. |
| Active readers / sessions / boks finished per week | distinct readers, sessions, `complete` events by week | Whether engagement grows with the reader base or dilutes. |
| Retention triangle | per arrival week: share still reading N weeks later, **with cohort size printed** | The standard retention view. Cohort size is beside every row because a percentage off four readers is one person changing their mind. |
| Arrived / finished one / finished three / created an account | readers whose first event was in the last 30 days | Activation. A reader who never finishes a boks has not experienced the product, so acquisition spend on them is wasted. |
| Boks published per week | `reels` published by week | Whether supply keeps pace with consumption. |

## Guests

Source: `get_guest_funnel` (latest in `20261014150000`) and, for one day,
`get_guest_day`.

Not recorded at all, since 2026-10-14: the local dev server (any local host) and
automated browsers (`navigator.webdriver`) - both used to show up here as
guests. `lib/boks/analytics-gate.ts`; a local build can opt in with
`localStorage["boks-record-analytics"] = "1"`. The unit is the guest
**device**; the team and hidden countries are left out as described on the tab.

### Did they touch it

Between "arrived" and "finished a bok" the funnel had only `start`, which is a
timer - 2.6 seconds on a bok - not a reader doing anything. This block says
whether guests put a hand on the page at all. Every share is of the devices
that were shown a bok.

| Field | Computed from | Decision it supports |
|---|---|---|
| Shown a bok | guest devices with an `impression` | The denominator. |
| Touched one | a `touch` event, or an outcome left by swipe, button or key | A page nobody touches is a first-screen problem (it does not invite a hand); a page people touch and leave is a choice-of-bok problem. |
| Tapped · scrolled the text | `touch` with `metadata.kind` `tap` / `scroll` - the **first** touch on each bok | Whether they tried to read, or only to move on. |
| Swiped to another bok | `complete`/`skip` with `metadata.from` in `swipe`, `button`, `keyboard` | Whether they found that there is more than one bok. |
| Swipes · boks touched of boks shown | count of those outcomes; distinct (session, bok) with a `touch` over those with an `impression` | Depth of trying, per bok rather than per device. |

`touch` is recorded by the reader once per bok and session, from window-level
pointer, key and text-scroll listeners (`components/boks/reader-feed.tsx`), with
the kind of the first touch; taps and scrolls start on 2026-10-14. Swipes come
from outcomes and reach back over the whole window. A press the browser takes
over (`pointercancel`) is counted as a swipe unless the text scrolled.

### Day by day, and one day opened

| Column | Computed from | Decision it supports |
|---|---|---|
| Guest devices · new | anonymous devices with reader events that day; devices first seen that day in either table | Volume. "New" can exceed guest devices: it includes arrivals that left before any bok loaded. |
| Shown a bok · touched · moved on | as in *Did they touch it*, per day | Which day's visitors tried at all - a day of untouched boks is a different day from a day of swipes. |
| Finished a bok | devices with a `complete` | The outcome. |
| Median time | per device, the sum over its boks of the largest `active_seconds`, middle device | Glance vs. read. |
| Where | the country each device was last seen from; *no country* is a device the Worker never saw - the local dev server | Strangers vs. ourselves. |

Clicking a day calls `get_guest_day(day, include_team, hide_countries)`: every
device seen that day (at most 300), with its visits (landing, the landed bok,
referrer, tracked link label, utm), sign-up prompts, and each bok it was shown
per session (at most 60) - time, seconds, the first touch, finished or how it
was left, like, share. Each device is summed up as one of: no bok shown,
looked and never touched, touched and did not finish, finished.

## Links

Tracked links: a link made here for one place you send boks to (a faculty chat,
a newsletter), and what it brought. Source: `get_link_attribution`, over
`boks_journey_events` visits (which carry `link_code` and `landing_reel_id`
since `20261011100000`) and `recommendation_events` for everything after.
The unit is the arriving **device**, as on the Guests tab, with the team and the
Guests tab's hidden countries left out the same way. A device counts once per
link, from its first visit through it in the window; outcomes run from that
arrival to today, so a newer link has had less time. Every share is printed
beside its denominator (the devices on the same row).

| Field | Computed from | Decision it supports |
|---|---|---|
| Visits · devices | sessions with a `visit` carrying the code; distinct `visitor_id` | Whether the link was opened at all, and by how many people rather than how many taps. |
| From | `referrer_host` of those visits | Was it opened where it was sent, or forwarded somewhere else. |
| Opened the bok · finished it | a `start` / `complete` on the link's bok by the arriving device, the arriving session included even when its event predates the visit row | Did the chosen bok work as a first bok. |
| Production | any event on the link's bok carrying `metadata.format` | Did they open the cinema or the immersive poem, the reason a series piece was sent. |
| Read another | a `complete` on any other bok after arriving | The product thesis per link: did one bok turn into reading. |
| Came back | reading on a later UTC day than the arrival | Habit, per link. |
| New accounts | of devices that arrived as guests, those later reading as an account created after the arrival | Conversion per link. Signing in to an older account is not counted. |
| Median min | median over arriving devices of Σ max(`active_seconds`) per (session, bok) from arrival | Depth, robust to one heavy reader. |
| Which bok they landed on | the same columns per `landing_reel_id`, for every shared-bok visit, tracked or not; "via tracked links" says how many came through one | Which piece to send next. |

## Moderation

| Field | Computed from | Decision it supports |
|---|---|---|
| Published / waiting / refused / approved from authors | `reels.status` | Queue state at a glance. |
| Queue item: status, submitted date, title, author, email, length, genre, mood, hook, full text, previous refusal reason | `get_boks_admin_snapshot` moderation rows | Everything needed to decide without opening another screen. |
| Refusal reason | required before refusing | The author sees it, so it cannot be optional. |

## Content

| Field | Computed from | Decision it supports |
|---|---|---|
| Minutes | Σ max(`active_seconds`) per boks | Which boks are actually read, rather than merely opened. This is the sort order. |
| Readers | distinct readers per boks | Exposure, so minutes can be read in context. |
| Finished | completions ÷ starts **above ten starts**; raw counts below that | Which boks hold people. Withheld as a percentage at low volume because three readers is not a rate. |
| Length | derived `minutes` and real `word_count` | The 15 minute promise. **Length is now derived from the text, not declared by the author** — the seeded catalog claimed 5-9 minutes for 68-92 word pieces. |
| Likes | `likes` table | Kept as a weak signal; at this scale it is too sparse to decide anything. |

## People

| Field | Computed from | Decision it supports |
|---|---|---|
| Reader (@nickname, email) | `user_profiles`, `auth.users` | Identity. |
| Role | `user_profiles.role` | Admin access, granted here only. |
| Minutes | Σ max(`active_seconds`) per reader | Who the product is actually for. Sorted by this. |
| Finished · of opened | `complete` events, distinct boks opened | Whether a reader is engaged or browsing. |
| Sessions | distinct `session_id` | Habit. |
| Arm | `recommendation_assignments.algorithm_id` | Which feed this reader sees, when a result needs explaining. |
| Last read | most recent reader event | Churn, per person. |

## Experiments

The analysis unit is the **reader**, stated on the page rather than implied. One
reader is one sample however much they read, and every interval on this tab is
computed over readers.

| Field | Computed from | Decision it supports |
|---|---|---|
| Divergence verdict | pairwise overlap of each algorithm's top ten over the live catalog | **Read this before anything else on the page.** Above ~80% overlap the arms serve the same feed and no result below can mean anything, at any sample size. |
| Readers measured · sessions · active reading | `get_reader_outcomes`, one row per (reader, algorithm, day) | The sample everything else is drawn from. |
| Events with a feed | events carrying a `served_feed` id ÷ all reader events | Whether results are reconstructible. Anything well below 100% means part of the window cannot be replayed. |
| Readers in both arms | readers with events under more than one algorithm | These are excluded from every comparison and from the arm summaries. A rising number means assignment is leaking. |
| Median read · median boks | median over readers in the arm | Arm summary, median because reading time is strongly right-skewed. |
| Effect, 95% interval, permutation p | one estimand throughout: the difference in reader means, its percentile bootstrap interval, and a permutation test on the same difference. Rates are shown in percentage points | The comparison itself. An interval spanning zero is reported as **inconclusive**, never as "no difference". |
| Power line | simulated from the spread actually observed | What this sample could have detected. Below the minimum detectable effect, the honest reading is that no experiment is running. |
| Per-reader values | printed whenever an arm holds 25 readers or fewer | At this size a founder reads twelve numbers better than one interval. |
| Completion / skip / reaction rate (table) | pooled over the arm's events, with one definition each (`RATE_PARTS`): completions ÷ starts, skips ÷ (starts + skips), reactions ÷ starts | **Description only.** A pooled rate weights a reader by how much they read; it is never the basis of a verdict. |
| Traffic split editor | `recommendation_experiments.arms`, control, readers needed per arm | Changes which algorithms are live without a deploy. Refuses a control with no traffic, because every arm is compared against it. Readiness is counted in readers and checked per metric. |

### Data quality

Every counter in this panel is a condition that used to be invisible, and
invisible is how broken numbers get trusted. Anything above zero is a reason to
distrust a comparison, not a number to optimise.

| Field | What a non-zero value means |
|---|---|
| Events with no served feed | The serve was not recorded, so the result cannot be replayed. |
| Events on no algorithm | Reading that belongs to no arm. |
| Degraded feeds | Ranked in the browser, or over a candidate set with no behavioural rollups. |
| Empty feeds | A serve with nothing in it. |
| Algorithm mismatch | The event and the feed it belongs to disagree about the arm. |
| Reel not in its feed | A read of something that feed never served. |
| Events before their feed | A clock or attribution fault. |
| Duplicate outcomes | Two verdicts for one read. |
| Clamped reading time | Hit the 24-hour ceiling; the clock is wrong. |
| Outcomes with no time | A read that took zero seconds. |
| Readers with no assignment | Events arriving with no stored arm. |
| Feeds by backend | `worker` is the canonical path. `browser` and `d1_fallback` are degraded serves (ADR-001). |
| Labelling versions | More than one version in a window means the read/skip rule changed mid-window; those events are not comparable. |

### What the Experiments tab deliberately does **not** show

Removed because each was a number that looked like a measurement and was not:

- **Engagement score** — `completes*7 + likes*5 + shares*5 + comments*8 - skips*3`. Five invented constants, and it was the default sort, so it decided what was read first.
- **Confidence labels** ("strong signal") — computed over event counts. Events within one reader are correlated, so this printed certainty off three readers.
- **Pace index** — divided a clamped minute estimate by wall-clock time.
- **Time to like, average start rank** — single-digit counts at this scale.
- **Per-segment breakdown** — segments are a hash of a browser id: random labels, not reader types.
- **Daily sparklines per arm** — daily rates at a dozen readers per arm. The eye finds trends in noise.
- **A lab report from D1** — the analysis unit is the reader and reader outcomes live in Supabase. A second report from a second store is how the console came to have two answers to the same question.

### Known limits, stated rather than hidden

- **At ~50 active readers, only very large differences are detectable.** Simulated: with 25 readers per arm, a +30% difference in reading time is detected about 15% of the time, +80% about 58%. Two arms rather than four doubles the sample behind every comparison, which is why the default is two. The power line on the page states this per comparison, from the spread actually observed.
- **The between-reader design is the weak one.** It is what exists today. A within-reader design (interleaving) is the only thing that resolves a realistic effect at this scale, and it arrives in a later phase.
- **Rate metrics exclude readers with fewer than five starts.** A rate over two starts is noise wearing a percentage sign. The excluded count is reported.
- **Reading fatigue is per browser, not per account.** The same reader on two devices shares an arm but not an "already read" set.
- **Distinct boks opened is counted per day and summed.** A reader who reopens the same boks on two days is counted twice. Fixing it costs a column in the RPC.

## Studies

The thesis studies (`docs/studies.md`). Each number is computed in the browser from the raw answers by `lib/boks/studies/results.ts`, one value per participant; admins' own runs are left out unless the box is ticked.

| Field | Computed from | Decision it supports |
|---|---|---|
| Participants, finished, by condition | `boks_study_participants` | Whether the arms are filling evenly; enrolment balances them. |
| Effect, 95% interval, n | the hypothesis's own outcome per participant: a scale mean, a share, or a paired difference; percentile bootstrap | Read against the hypothesis threshold. Below 5 an arm nothing is estimated; at pilot size the interval, not "met", is the result. |
| Facts | refusals (А1), sessions with nothing opened (РГ2), screened out (Б2), accepted algorithm fragments (Б3) | The denominators the comparisons hide. |
| Fragment table (Б3) | ratings per fragment, «да» to both, accepted at two of three | Which fragments the algorithm got right, beside the same-length windows. |

