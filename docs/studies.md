# Studies

The controlled tests behind the thesis hypotheses of the third research semester (НИР3, presentation of 21 October 2026). The recommendation lab (`/admin` → Experiments) compares algorithms on the live feed by attributed behaviour; a **study** is different: a participant opens a link, is assigned a condition, reads what the protocol gives them and answers a few questions. Hypothesis А3 (detecting a finished read) is not here: it is being replaced by a stronger one.

## How a study runs

- **Every study starts switched off.** Studio → Research → Studies has one switch per study. Off, the participant page `/study/<key>` says no study is running, and the database refuses every enrolment and answer (`55000`). The link can be printed and handed out before the study starts.
- A study can be switched on only with materials its protocol can use: the bok ids it reads (pairs, sets, showcases), checked in the Studio editor by `lib/boks/studies/materials.ts` - shape, published, and Series where Series is played. Materials cannot be changed while a study runs: a running participant's plan is derived from them.
- **Preview**: `/study/<key>?preview=1&condition=<condition>` runs the whole protocol for an admin, on or off, writing nothing. The Studio tab links one preview per condition.
- **Participant forms for the presentation**: Studio → Studies → Participant forms shows every screen of every protocol in a phone-sized frame, in Russian or English, with sample public-domain texts. They are the same components the participant page renders.
- Switching off stops new participants and answers and keeps everything collected.

A participant is any Supabase session, a guest's included; nobody signs up. The server assigns the condition (the least-used one so far, ties at random: balanced arms at pilot sizes) and a seed. Every random order after that - which pair, which target, the order of a showcase - is drawn from the seed in `lib/boks/studies/plan.ts`, so a plan is the same on a reload and can be rebuilt in the analysis. A participant who finished is thanked on a second visit, not run again; one who left half-way starts the protocol again, and the analysis reads their first answer to each step.

## The protocols

| Study | Conditions | What the participant does | Primary outcome |
|---|---|---|---|
| **РГ1** `rg1` - value of Boks Series | `series`, `text` (between) | Meets both formats on a familiarization piece, then reads one target piece in the assigned format | «Произведение меня тронуло», «Произведение заставило задуматься», 1–7. Both ≥ +0.5 |
| **РГ2** `rg2` - value of the personal feed | `feed`, `catalogue` (between) | Ten minutes in their own served feed, or a catalogue of the same texts (alphabetical, search, verse/prose, ≤5 min, language), then a survey | Successful session (below). ≥ +15 pp |
| **А1** whole vs fragment | `whole_first`, `fragment_first` (within; order) | Reads a whole work and a fragment from two different pairs, rates closure after each, then freely chooses among two new texts of each kind, unlabelled, or none | Chose whole minus chose fragment, everyone in the denominator. ≥ +15 pp |
| **А2** text in the feed vs card | `inline_a`, `inline_b`, `cards_a`, `cards_b` (within; interface × set counterbalanced) | Marks the texts they know; two ten-minute sessions, one per interface, with the other set; a survey after each | Paired difference of successful sessions. ≥ +10 pp |
| **Б1** interaction vs passive | `yoked` (within) | Two immersive poems: one active (their gestures are recorded), one passive (another participant's recorded gestures are replayed at the same moments) | Mean of two intensity questions, 1–7. ≥ +0.5 |
| **Б2** Series as a way into an author | `series`, `text` (between) | Ticks the authors they know; meets an unknown author through one piece in the assigned format; then the same showcase for both conditions: one other plain text by that author, up to five by others | Chose and started another text by the author. ≥ +15 pp |
| **Б3** standalone fragments | `rater` | Reads a fragment, answers «понятен без остальной книги?» and «завершилась мысль или эпизод?» (да / нет / затрудняюсь), as many as they like | A fragment is accepted with «да» to both from two of three raters. ≥ 80 of 100 algorithm fragments |

The condition lists live in `lib/boks/studies/protocol.ts` and in `boks_study_conditions` in the migration; a unit test holds them equal.

**Successful session** (РГ2, А2; `lib/boks/studies/session.ts`): within the session's minutes the participant opened a text they had not read before, read it to the end - by the measurement (the feed's own `inferReadOutcome` on foreground time and scroll) *and* by their own answer - and rated the choice 4 or 5 of 5. Every raw value is stored, so another rule can be applied to the same data. The survey asks only about texts with at least 5 foreground seconds.

**Started** (Б2): opened and read for at least 10 foreground seconds or a fifth of the way.

**Б1's yoke** (`lib/boks/studies/gesture-trace.ts`): the active participant's pointer samples are keyed to the recording's own clock and to fractions of the picture, and replayed through the same hand functions in `ImmersivePoem`; a passive participant cannot gesture, a tap still pauses. A trace is replayed once (`boks_study_yokes`). A piece is passive when a trace is waiting and the participant has not had a passive piece yet, so from the second participant on everyone gets one of each. A gesture made while the reading was paused collapses to one moment in the replay; the trace counts those samples (`pausedSamples`). Only immersive poems have gestures, so Б1's pieces must be poems.

Inside a study the Series players run without their shared ending (`withoutFinale`): it asks "what stayed with you - moved me, want to think", which in РГ1 would put the questions' own words in front of one condition only.

## Data

Migration `20261026100000_boks_studies.sql`. Five tables, none reachable from the Data API; everything goes through RPCs that check the switch, the caller and sizes:

- `boks_studies`: one row per study - the switch and the materials.
- `boks_study_participants`: one row per study per Supabase user - condition and seed.
- `boks_study_responses`: one row per answer or measurement, by `step`: `familiarity`, `after_reading`, `choice`, `session`, `session_survey`, `trace`, `fragment_rating`. At most 300 per participant, 128 KB each.
- `boks_study_fragments`: Б3's fragments, imported in Studio as a JSON array from the fragment prototype. The method (`algorithm` or `window`, the same-length comparison) is never returned to a rater.
- `boks_study_yokes`: which passive participant replayed which trace.

Participant RPCs: `get_boks_study`, `enroll_in_boks_study`, `record_boks_study_response`, `complete_boks_study`, `next_boks_study_fragment`, `claim_boks_study_trace`. Admin RPCs: `list_boks_studies`, `set_boks_study_enabled`, `set_boks_study_materials`, `get_boks_study_responses`, `import_boks_study_fragments`, `list_boks_study_fragments`, `delete_boks_study_fragment_batch` (removes only unrated fragments). The behaviour is asserted in `scripts/local-supabase/checks.sql`.

## Results

Studio → Studies → Results computes each study from the raw answers in `lib/boks/studies/results.ts`: one value per participant, the difference against the hypothesis threshold, a 95% bootstrap interval (`lib/recsys/statistics/`), and "needs N an arm" below five participants per arm. Admins' own runs are left out unless asked for. CSV and JSON export the raw answers for any other analysis.

## Code

- `app/study/[key]/page.tsx` → `components/boks/studies/study-page.tsx`: loading, preview, consent, enrolment.
- `components/boks/studies/study-protocols.tsx`: the seven protocols as sequences of screens; `study-forms.tsx` the forms; `study-reader.tsx` measured reading and the feed / cards / catalogue sessions; `study-series.tsx` the Series player; `study-copy.ts` every participant-facing word (the wording is the instrument: change it only with a note here).
- `components/boks/admin/studies.tsx` and `components/boks/admin/study-form-gallery.tsx`: the Studio tab.
- `lib/boks/studies/`: protocol, materials, plans, sessions, gesture traces and results - pure and unit-tested.
