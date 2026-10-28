# Fragment cutter (Б3)

The prototype behind hypothesis Б3: from a long work, cut fragments of 1–5 minutes of reading that stand on their own, with the source text kept verbatim. It runs in two places with the same code (`lib/boks/fragments/pipeline.ts`):

- **Studio → Research → Cutter**: upload or paste a work, cut it, read the fragments with their scores, download the report, import into a Б3 batch.
- **`scripts/cut-fragments.mts`**: the same pipeline over a directory of books, writing the JSON array Studio → Studies → Б3 imports.

A work may yield fewer fragments than asked for, or none. That is a result, not a failure: the page and the report say why.

## The pipeline

Cheap, certain stages first; the language model last and only where the cheap ones point. Every fragment is `source.slice(start, end)` between paragraph edges (or sentence edges inside a paragraph too long to cut around): no stage, and nothing the model says, changes a character.

| # | Stage | Where | What it adds |
|---|---|---|---|
| 1 | Structure | `text.ts` | Paragraphs by character offsets; hard-wrapped (Gutenberg) and one-per-line layouts told apart; headings (`Глава III`, `II.`, `* * *`) and dialogue marked. Paragraphs longer than half the maximum length are split at sentence ends into pieces marked `continued`, so a work pasted with no line breaks still has places to cut. |
| 2 | Lexical cohesion | `cohesion.ts` | TextTiling (Hearst 1997): cosine of the 120 content tokens before and after every gap, smoothed; a gap's depth in that curve is its boundary strength. |
| 3 | Transition markers | `markers.ts` | "На другой день", "Через неделю", "Между тем", "The next morning" at a paragraph's start: a new scene that keeps its vocabulary, which TextTiling cannot see. |
| — | Fusion | `pipeline.ts` | The signals become one boundary strength per gap by noisy-OR: `1 − Π(1 − wᵢ·sᵢ)`, with w = 0.95 heading, 0.85 model scene change, 0.7 lexical depth, 0.5 marker. A gap is a boundary unless every signal fails to make it one. |
| 4 | Candidates | `candidates.ts` | Every run of whole paragraphs reading in 1–5 minutes (238 words a minute, the feed's constant), not starting or ending on a title. Score = mean fused boundary at the edges + ½ internal cohesion − 0.6 × strongest boundary inside (a span across a scene change reads as two halves) + 0.4 × (scene rating − ½) + edge cues (dangling "Он"/"Но"/"However" start, cut through dialogue, unfinished last sentence, mid-paragraph edges). Picks are spread across the work by maximal marginal relevance (Carbonell & Goldstein 1998), so five fragments do not all come from one strong chapter. |
| 5 | Scenes (model) | `scenes.ts` | The model reads the regions around the best candidates as numbered paragraphs (long ones shortened to their opening and close) and marks where each scene begins, how sharp the change is (chapter / strong / weak) and how well the scene reads alone (1–5). The changes join the fusion, the ratings the score, and the candidates are scored again. Only spans the model saw whole compete afterwards. |
| 6 | Edges (model) | `refine.ts` | For each pooled candidate, the model sees it with three paragraphs either side and may move its start and end to other paragraph boundaries. It answers with two numbers; the choice is checked against the length and heading rules and dropped if it breaks one. |
| 7 | Judge (model) | `judge.ts` | The model reads the fragment as a feed reader would ("Из «title», author" and the text), retells it in one sentence, answers a checklist of six yes/no questions (names who; clear setting; something happens; needs no backstory; closes the episode; no open question), rates interest 1–5, and answers the two Б3 questions as yes / no / unsure. The checklist gives standalone, complete and opening scales. |
| 8 | Tournament (model) | `tournament.ts` | The survivors (6–10) are compared in pairs, "which reads better on its own?", each pair in both orders; a pair answered inconsistently is a draw. Swiss pairing, three rounds. |
| 9 | Rank and accept | `pipeline.ts` | Final = 0.2 algorithm (normalised within the pool) + 0.3 judge + 0.5 tournament share. A fragment is kept only if it does not end mid-sentence and clears the strictness bar on the judge's scales; at most N are kept. |

Without a model, stages 5–8 are skipped, the final score is the algorithm's, and the bar is the algorithm's own red flags (ends mid-sentence or mid-dialogue, weak edges).

### Strictness

The judge is used as a veto on agreed evidence, not as an approval:

| Level | standalone ≥ | complete ≥ | judge ≥ |
|---|---|---|---|
| lenient | 2 | 1.5 | 0.25 |
| normal (default) | 2.5 | 2 | 0.35 |
| strict | 3 | 3 | 0.5 |

The reason is in the first runs below: a model asked about one excerpt on its own leans to "this is incomplete" whatever the excerpt, so an approval bar keeps nothing.

## Choice of models

Two providers are wired (`llm.ts`): Yandex AI Studio through its OpenAI-compatible chat endpoint, and Anthropic's Messages API. Both are asked for structured output against the stage's JSON schema; no stage parses prose. In Studio only Yandex is wired, through the Worker.

Default per stage: **Alice AI LLM** (`aliceai-llm`) for scenes, edges and the judge; **gpt-oss-120b** for the tournament. Each stage's model can be changed on the page or with `--model` / `--tournament-model`.

What the first runs (2026-10-28) showed, which is why:

- **Absolute 1–5 scales do not separate fragments with Alice.** With a judge asking for standalone / complete / opening / interest on 1–5, Alice rated standalone 2 for 13 of 15 candidates of «Дуэль» and 1 for the other two, and listed "relationships between the characters are not explained" as missing context for every one. Recalibrating the prompt (names without backstory are normal in an excerpt) moved every standalone, complete and opening score to exactly 3. A binary checklist (CheckEval, Lee et al. 2024; TICK, Cook et al. 2024) with a one-sentence summary first separated them.
- **The models' sense of an ending leans to "unfinished".** Both Alice and gpt-oss-120b described the last paragraphs of «Дуэль» — the actual end of the novella — as "a pause before the next episode" or "cut mid-action". Hence the veto rather than approval.
- **Alice cannot compare two fragments.** In a full run on «Степь» with Alice in the tournament, none of 13 pairs got the same winner in both orders. Asked directly which of A and B reads better on its own, it answered "B" in all 8 test calls: one pair as is, three pairs with each one's strengths and flaws asked for first, each in both orders. YandexGPT 5 Pro gave the same answer in both orders for 1 of the 3 pairs, gpt-oss-120b for 2 of 3 (both times preferring the opening of «Степь», the fragment an editor would choose). Hence gpt-oss for the tournament, and every pair asked in both orders (position bias: Zheng et al. 2023).

### Runs on two Chekhov novellas

`scripts/cut-fragments.mts --llm yandex`, defaults (5 per work, pool 15, 16 scene chunks, 3 rounds, normal):

| Work | Words | Candidate spans | Calls | Tokens (in + out) | Kept |
|---|---|---|---|---|---|
| «Степь» | 28,939 | 20,335 | 75 | 146,948 + 13,527 | 5 |
| «Дуэль» | 31,924 | 27,505 | 70 | 142,744 + 11,424 | 5 |

Each took a minute and a half to two minutes, nearly all of it waiting for the model. In «Степь» the first fragment is the novella's opening (Егорушка leaving the town), then the sheepdogs, the storm, the well, the steppe through the day. In «Дуэль»: the shot at the duel, the birthday conversation about prejudice, the deacon on his way to the duel, the preparations, the letter. The offline stages alone take 60–170 ms on these and on a 120,000-word collection, and prefer whole chapters (headings at both edges).

What this does not show: that these fragments beat same-length windows for readers. That is what Б3 measures.

## Using it in Studio

Studio → Research → **Cutter**. Upload a `.txt` (UTF-8 or Windows-1251) or paste the text, give the title and author (the model and the raters see them), choose how many fragments, the strictness, and whether to use the model; "Model stages" shows each stage's switch and model and an upper bound on calls. **Cut** runs the pipeline in the browser; only the model stages leave it, one task per request, through `/api/admin/fragments/llm`. **Stop** cancels.

The result shows the status (as many as asked / only some / did not cut) with the reasons, each stage's time and calls, and every fragment with its scores, checklist, summary, what a reader would miss, where the model moved its edges, and the text. **Б3 rows** downloads the import array (fragments and a same-length window for each); **Import into Б3** writes it straight into a batch; **Report** downloads everything.

### The Worker route

`app/api/admin/fragments/llm/route.ts` takes one task, checks the caller is an admin (`is_boks_admin`, asked with the caller's own token), bounds the task (system ≤ 8,000 characters, user ≤ 60,000, ≤ 4,000 tokens, a fixed list of models and stages), forwards it to Yandex and returns the JSON and token counts. A 429 (Yandex allows five generations in flight per folder) is passed on, and the browser retries with backoff; the browser also keeps at most four calls in flight.

The key and folder are Worker secrets, never in source or the build:

```bash
npx wrangler secret put YANDEX_API_KEY      # an API key of a service account allowed to use the models
npx wrangler secret put YANDEX_FOLDER_ID    # the folder that account belongs to
```

Without them the route answers 503 and the page can still cut offline.

## The CLI

```bash
npx tsx --tsconfig tsconfig.json scripts/cut-fragments.mts books/ --out b3.json
YANDEX_API_KEY=… YANDEX_FOLDER_ID=… npx tsx --tsconfig tsconfig.json scripts/cut-fragments.mts \
  book.txt --title "Дуэль" --author "Антон Чехов" --language ru --llm yandex --out b3.json
ANTHROPIC_API_KEY=… npx tsx --tsconfig tsconfig.json scripts/cut-fragments.mts books/ --llm anthropic --out b3.json
```

- Input: UTF-8 `.txt` files, or directories of them, holding the work and nothing else (remove a Gutenberg header and licence by hand).
- Title, author, language: a sidecar `<name>.json` (`{ "title": "…", "author": "…", "language": "ru" }`), else `--title` / `--author` / `--language` for a single file, else the file name and the share of Cyrillic letters.
- Options: `--per-work 5`, `--seed 1`, `--out`, `--llm yandex|anthropic`, `--model`, `--tournament-model`, `--pool`, `--scene-calls 16`, `--votes 1` (judgements averaged per fragment), `--rounds 3`, `--strictness normal`, `--no-scenes`, `--no-refine`, `--no-judge`, `--no-tournament`.
- A report per work goes to stderr and, with `--out`, to `<out>.report.json`: status and diagnosis, stage times, usage, scenes, every kept and rejected fragment with offsets, cues, scores, the judgement and the reasons.

Rows of all works are shuffled with the seed, so the file's order does not give the method away. For the thesis sample, import the cutter's fragments as they come out, before any manual edits: those are the boundaries the hypothesis is about. Each row is `{ method: "algorithm" | "window", sourceTitle, sourceAuthor, language, body, rank }`; the import takes at most 500 rows at a time.

## Limits

- Weights (fusion, score, final mix) and strictness levels are a first calibration on two works, not fitted. With rated fragments from Б3 they can be fitted, which is the natural next step for the thesis.
- The model sees the regions around the best offline candidates, not the whole work: a good scene the offline stages scored low is never shown to it. More scene chunks widen the net at a cost.
- Stemming is a prefix cut and stopword lists are short; cohesion is noisy on dialogue-heavy chapters.
- Heading detection is heuristic. A short all-caps line in the text can be taken for a heading and then cannot end a fragment.
- Model answers at temperature 0 are reproducible for one model version, not across versions; the report records which model answered each stage.
- One work of 30,000 words costs about 70 model calls and 150,000 tokens with the defaults.
- The Anthropic path is built and unit-tested on its request and response shapes but has not been run against the API.
