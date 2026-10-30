# Studies

The controlled tests behind the thesis hypotheses of the third research semester (НИР3, presentation of 21 October 2026, hypotheses as revised on 28 October). The recommendation lab (`/admin` → Experiments) compares algorithms on the live feed by attributed behaviour; a **study** is different: a participant opens a link, is assigned a condition, reads what the protocol gives them and answers a few questions. Every hypothesis of the presentation has its protocol here: РГ1, РГ2, А1–А3 and Б1–Б3.

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
| **РГ1** `rg1` - value of Boks Series | `series`, `text` (between) | Meets both formats on a familiarization piece, then reads one target piece in the assigned format | Share answering 6 or 7 to both «Произведение меня тронуло» and «заставило задуматься», 1–7. ≥ +10 pp, 95% interval above 0; the means are secondary |
| **РГ2** `rg2` - value of the personal feed | `feed_first`, `catalogue_first` (within; order) | Ten minutes in their own served feed of full texts and ten in a catalogue (alphabetical, search, verse/prose, ≤5 min, language), in the assigned order. The sessions get different texts: the served slate split by alternating ranks, the seed choosing which half the feed gets (`planRg2`). The same survey after each | «Насколько вы довольны этим сеансом выбора и чтения?» 1–7, asked after every session, also when nothing was opened. Share satisfied (6 or 7), paired feed − catalogue ≥ +10 pp, 95% interval above 0. Secondary: the mean, «Прочитанное меня тронуло» 1–7 and the successful session |
| **А1** whole vs fragment | `whole_first`, `fragment_first` (within; order) | Reads a whole work and a fragment from two different pairs, then freely chooses between two new cards, one of each kind, unlabelled, or none; only after the choice rates closure of what was read | Chose whole minus chose fragment, everyone in the denominator. ≥ +15 pp |
| **А2** choosing by cards | `inline_a`, `inline_b`, `cards_a`, `cards_b` (within; interface × set counterbalanced) | Marks the texts they know; two ten-minute sessions, a feed of cards (cover, title, author, time, opening lines) and a feed of full texts with the same data, with the other set; a survey after each | A text chosen and 6 or 7 to «Мне было легко выбрать» 1–7; «nothing» fails. Paired share, cards − full texts, ≥ +10 pp, 95% interval above 0. Secondary: successful session, satisfaction |
| **А3** `a3` - recommendations from five boks | `profile` (one; the comparison is offline) | Reads their own served feed (without the test pool), one text at a time, rating interest 1–5 on leaving each. After five the profile is fixed and both versions' orders recorded; ten texts from the test pool by other authors follow in the seed's order, rated the same way. Can stop and come back to the same place | Precision@5 (share of the top five rated 4–5) with the profile minus without. ≥ +10 pp, 95% interval above 0. Secondary: NDCG@5, gain = interest − 1 |
| **Б1** immersion from two actions | `yoked` (within) | Two immersive poems with two interactive actions: one with actions (their gestures are recorded), one automatic (another participant's recorded session replayed: the same effects and pauses at the same moments) | «Насколько сильно вы были погружены в произведение?» 1–7. Share answering 6 or 7, with actions minus automatic, paired, ≥ +10 pp, 95% interval above 0; the mean is secondary |
| **Б2** music and the enjoyment of reading | `music_a`, `music_b`, `silence_a`, `silence_b` (within; mode × set counterbalanced) | Marks the texts they know; puts headphones on; reads plain texts (no narration) for five minutes with the quiet boks reading music and five in silence, the first block's mode and set from the condition, the second the other of both; a short pause between. After each block two questions | «Насколько вам понравился сам процесс чтения?» 1–7. Share answering 6 or 7, music minus silence, paired; confirmed only if the whole 95% interval is above +10 pp. Secondary: the mean and «Насколько вас что-то отвлекало от чтения?» 1–7 |
| **Б3** standalone fragments | `rater` | Reads a fragment, answers «понятен без остальной книги?» and «завершилась мысль или эпизод?» (да / нет / затрудняюсь), as many as they like | A fragment is accepted with «да» to both from two of three raters. ≥ 80% of algorithm fragments and ≥ +10 pp over random windows of the same length |

The condition lists live in `lib/boks/studies/protocol.ts` and in `boks_study_conditions` in the migration; a unit test holds them equal.

**Successful session** (РГ2, А2; `lib/boks/studies/session.ts`): within the session's minutes the participant opened a text they had not read before, read it to the end - by the measurement (the feed's own `inferReadOutcome` on foreground time and scroll) *and* by their own answer - and rated the choice 4 or 5 of 5. Every raw value is stored, so another rule can be applied to the same data. The survey asks only about texts with at least 5 foreground seconds.

**А3's two versions** (`lib/boks/studies/a3.ts`): the production ranker (`for_you`, through `buildReaderFeed`) orders the same ten from one snapshot of counters taken when the profile is fixed (`get_boks_study_a3_candidates`). With the profile, its semantic taste is each target's cosine to the profile vector: the five rated texts' vectors, each weighted by interest − 3, after subtracting the centre of the fifteen vectors in play (two short literary texts sit near 0.85 whatever they are about, and the shared part would otherwise drown the ratings). Without it, the taste is absent. The reader is a stranger in both - no history, no novelty term, the same per-reader jitter - so only the profile differs. The ten are shown in the seed's order, never either version's, so showing helps neither (Schnabel et al., 2016), and their ratings do not touch the profile. The `ranking` step stores the profile, the targets, both orders, every similarity and the ranker's clock, so the analysis can rank again. Five ratings all at 3 carry no direction: no profile, both orders equal, kept in. Ten ratings all at 1 give no ideal order: left out and counted.

**Б2's music** (`components/boks/reading-music.ts`): the same track and the same fixed level as the reader's own music, 0.42 of full volume. The intro's button starts it (a browser plays sound only after a gesture) and the end of the block stops it, without touching the reader's own music setting; a silence block stops any music already playing. Each block is the a2 inline feed with the block's set, measured the same way (step `session`, with `mode`); the answers are step `session_survey` with `mode`, `enjoyment` and `distraction`.

**Б1's yoke** (`lib/boks/studies/gesture-trace.ts`): the active participant's pointer samples are keyed to the recording's own clock and to fractions of the picture, and replayed through the same hand functions in `ImmersivePoem`; a passive participant cannot gesture, a tap still pauses. A trace is replayed once (`boks_study_yokes`). A piece is passive when a trace is waiting and the participant has not had a passive piece yet, so from the second participant on everyone gets one of each. A gesture made while the reading was paused collapses to one moment in the replay; the trace counts those samples (`pausedSamples`). Only immersive poems have gestures, so Б1's pieces must be poems.

Inside a study the Series players run without their shared ending (`withoutFinale`): it asks "what stayed with you - moved me, want to think", which in РГ1 would put the questions' own words in front of one condition only.

## Data

Migration `20261026100000_boks_studies.sql`. Five tables, none reachable from the Data API; everything goes through RPCs that check the switch, the caller and sizes:

- `boks_studies`: one row per study - the switch and the materials.
- `boks_study_participants`: one row per study per Supabase user - condition and seed.
- `boks_study_responses`: one row per answer or measurement, by `step`: `familiarity`, `after_reading`, `choice`, `session`, `session_survey`, `trace`, `fragment_rating`, `interest`, `ranking`. At most 300 per participant, 128 KB each. `get_boks_study` returns a participant's own `interest` and `ranking` answers, so a3 resumes where it stopped.
- `boks_study_fragments`: Б3's fragments, imported in Studio as a JSON array from the fragment cutter (`docs/fragment-cutter.md`). The method (`algorithm` or `window`, the same-length comparison) is never returned to a rater.
- `boks_study_yokes`: which passive participant replayed which trace.

Migration `20261028100000_boks_studies_rg2_within_and_a3.sql` made РГ2 within-participant and added А3 with its snapshot RPC. Migration `20261029100000_boks_study_b2_music.sql` replaced Б2 (Series as a way into an author, which never ran) with music against silence, and reset its switch and materials.

Participant RPCs: `get_boks_study`, `enroll_in_boks_study`, `record_boks_study_response`, `complete_boks_study`, `next_boks_study_fragment`, `claim_boks_study_trace`, `get_boks_study_a3_candidates` (also an admin's, for a preview). Admin RPCs: `list_boks_studies`, `set_boks_study_enabled`, `set_boks_study_materials`, `get_boks_study_responses`, `import_boks_study_fragments`, `list_boks_study_fragments`, `delete_boks_study_fragment_batch` (removes only unrated fragments). The behaviour is asserted in `scripts/local-supabase/checks.sql`.

## Results

Studio → Studies → Results computes each study from the raw answers in `lib/boks/studies/results.ts`: one value per participant, the difference against the hypothesis threshold, a 95% bootstrap interval (`lib/recsys/statistics/`), and "needs N an arm" below five participants per arm. Admins' own runs are left out unless asked for. CSV and JSON export the raw answers for any other analysis.

## Code

- `app/study/[key]/page.tsx` → `components/boks/studies/study-page.tsx`: loading, preview, consent, enrolment.
- `components/boks/studies/study-protocols.tsx`: the eight protocols as sequences of screens; `study-forms.tsx` the forms; `study-reader.tsx` measured reading and the feed / cards / catalogue sessions; `study-series.tsx` the Series player; `study-copy.ts` every participant-facing word (the wording is the instrument: change it only with a note here).
- `components/boks/admin/studies.tsx` and `components/boks/admin/study-form-gallery.tsx`: the Studio tab.
- `lib/boks/studies/`: protocol, materials, plans, sessions, gesture traces, a3's profile, rankings and NDCG, and results - pure and unit-tested.

## Wording changes

- 28 October 2026: the session survey (РГ2, А2) gained «Насколько вы довольны этим сеансом выбора и чтения?» (1 совсем недоволен - 7 полностью доволен), always asked, and «Прочитанное меня тронуло» (1–7) when a text was opened: the presentation's РГ2 metric and its emotional response. А3 asks «Насколько вам был интересен этот текст?» 1–5.
- 29 October 2026, following the presentation's revised hypotheses: Б1 asks one question, «Насколько сильно вы были погружены в произведение?» (1 совсем не погружён(а) - 7 полностью погружён(а)), instead of the two intensity questions. Б2 is a new study with «Насколько вам понравился сам процесс чтения?» and «Насколько вас что-то отвлекало от чтения?» (1 совсем нет - 7 очень сильно) after each block.
- 30 October 2026, following the shared presentation: А2 asks «Какой текст вы выбрали?» (or «Ничего») and «Мне было легко выбрать» 1–7 after each session, and compares cards against full texts instead of judging the successful find. РГ2's feed shows full texts. А1 asks about closure after the choice, between two cards.
