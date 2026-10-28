# Fragment cutter (Б3)

The prototype behind hypothesis Б3: from a long work, cut fragments of 1–5 minutes of reading that stand on their own, with the source text kept verbatim. Its output is the JSON array Studio → Studies → Б3 imports (`docs/studies.md`).

## What it does

For each work:

1. **Paragraphs** by character offsets (`lib/boks/fragments/text.ts`). Hard-wrapped text (Gutenberg) and one-paragraph-per-line text are told apart by whether lines that continue onto the next one end mid-sentence. Headings (`Глава III`, `II. ГОСПОДИН БАХЧЕЕВ`, `CHAPTER 4`, `* * *`) and dialogue lines are marked.
2. **Lexical cohesion** after TextTiling (Hearst 1997; `cohesion.ts`): at every gap between paragraphs, the cosine similarity of the 120 content tokens before it and the 120 after it, smoothed; a gap's depth in that curve is its boundary strength. Tokens are lowercased, stopwords dropped, Russian words cut to five letters, English stripped of a few suffixes.
3. **Candidates** (`candidates.ts`): every run of whole paragraphs that reads in 1–5 minutes at the feed's 238 words per minute (`readingWordsPerMinute`), not ending on a heading. Score = boundary strength at both edges + half the internal cohesion + cues at the edges: starts or ends at a section, a dangling first word ("Он", "Но", "И", "However"), a cut through an exchange of dialogue, an unfinished last sentence. The weights are written down in the file.
4. **Selection**: best first, never two sharing a paragraph, the first five ranked 1..5.
5. **Model check** (optional, `--llm`; `model-check.ts`): Claude (`claude-haiku-5-5` by default) is shown each of the first fifteen candidates under the rater's own "From «title», author" line and asked the raters' two questions, answering yes / no / unsure through a JSON schema. Candidates it accepts on both go first; nothing is dropped, and it cannot change the text: the imported body is always the slice of the source.
6. **Windows** (`windows.ts`): for every fragment, a window with exactly as many words (counted as the database counts them, runs of non-space), starting at a paragraph start drawn from a seeded generator, not snapped to a sentence, and away from the fragments when the work leaves room.

Rows of all works are shuffled with the seed, so the file's order does not give the method away.

## Running it

```bash
npx tsx --tsconfig tsconfig.json scripts/cut-fragments.mts books/ --out b3.json
npx tsx --tsconfig tsconfig.json scripts/cut-fragments.mts book.txt \
  --title "Село Степанчиково и его обитатели" --author "Фёдор Достоевский" --language ru --out b3.json
ANTHROPIC_API_KEY=… npx tsx --tsconfig tsconfig.json scripts/cut-fragments.mts books/ --llm --out b3.json
```

- Input: UTF-8 `.txt` files, or directories of them. Each file holds the work and nothing else: remove a Gutenberg header and licence by hand, since the cutter never edits text.
- Title, author, language: a sidecar `<name>.json` beside the file (`{ "title": "…", "author": "…", "language": "ru" }`), else `--title` / `--author` / `--language` for a single file, else the file name and the share of Cyrillic letters.
- Options: `--per-work 5`, `--seed 1` (the same seed gives the same file), `--out file.json` (stdout without it), `--llm`, `--model`, `--pool` (candidates the model sees, default three times `--per-work`).
- Without `ANTHROPIC_API_KEY` everything runs offline; `--llm` then says so and the run is marked not model-checked.

A report per work goes to stderr and, with `--out`, to `<out>.report.json`: offsets, minutes, score and its parts, cues, the model's verdict, and `modelChecked`. The import rows carry none of this.

## Into Studio

Studio → Studies → Б3 → paste the contents of the `--out` file, name the batch (`pilot-1`), Import. Each row is `{ method: "algorithm" | "window", sourceTitle, sourceAuthor, language, body, rank }`; `rank` is 1..N for the algorithm and null for a window. The import takes at most 500 rows at a time, so 20 works × 5 × 2 = 200 fit in one batch. Raters never see the method.

For the thesis sample, import the cutter's first five per work as they come out, before any manual edits: those are the original boundaries the hypothesis is about.

## Limits

- Fragments are whole paragraphs. A work with paragraphs longer than five minutes of reading yields no candidate from them.
- Stemming is a prefix cut and stopword lists are short; cohesion is noisy on dialogue-heavy chapters, where every paragraph is a line.
- Heading detection is heuristic. A missed heading costs a cue; a short all-caps line in the text can be taken for a heading and then cannot end a fragment.
- The score weights are a first guess, not fitted. The study measures whether the result beats same-length windows; it does not show these weights are best.
- In a work too short for its windows to avoid the fragments, a window may overlap one; the report says so.
- The model check is one call per candidate (about 300 for 20 works) and is not cached between runs.
