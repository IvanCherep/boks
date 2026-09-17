# Where boks Stands

One page so a new session can orient without reading four handovers and two
research reports. Updated 2026-09-17 (reader redesign in the current worktree).

For *why* a thing is the way it is, the handovers and ADRs are the record. This
says only what is true now.

---

## Live

**https://tryboks.com** — Cloudflare Worker `read`, attached as a custom domain
on 2026-09-17. The zone is registered through Cloudflare Registrar in the same
account, so no nameserver change was needed.

`https://read.tryboks.workers.dev` still serves the same Worker and stays on
until nothing live points at it: magic links already in inboxes name it, and it
is still the `site_url` in production auth. Two things to know about it:

- **`workers_dev` has to be declared in `wrangler.jsonc`.** Omitting it defaults
  it to false, and the first `wrangler triggers deploy` turned the workers.dev
  subdomain into a 404. Caught in the same minute; the flag is now explicit.
- **`www.tryboks.com` is deliberately not attached.** A second custom domain
  would serve the app from a second origin, and an origin is a separate browser
  storage bucket - sign in on one and the other still looks signed out. `www`
  belongs behind a zone-level redirect rule to the apex. Production backend is the Supabase project
`vcmrvnihbptostnzaean` (eu-west-2).

All 32 migrations are applied to production. The production database is on the
current schema, which means **older client code will not work against it** —
`user_profiles.display_name` no longer exists, and code that reads it breaks.
Deploy from current source rather than rolling the Worker back on its own.

Deployed and working: the reader, the `for_you` ranker behind `/api/feed` with
served-feed provenance, author pages and follows, per-boks and per-author share
links, the rebuilt comment sheet, handle-only identity, and the admin console.

Catalogue import landed on top of that: an admin loads a folder of files into a
publisher account, each piece keeping its own byline. See
`docs/catalogue-import.md`. Measured at 500 boks in about a second, and
repeatable - a second run of the same files writes nothing.

Copyright followed: publishing requires the author to confirm they hold the
rights, with an optional admin-only note saying where they come from; every bok
carries a **⋯** menu a reader can report it from; an admin reads the reports
beside the author's claim and can withdraw a published piece. See
`docs/copyright.md`. Rights text and reports live in their own admin-only
tables, because `authenticated` can select `public.reels` directly.

**The catalogue is now real literature.** The 37 seeded demo boks are gone and
457 public-domain pieces by 24 authors - Dickinson, Chekhov, O. Henry, Saki,
Mansfield, Shakespeare's sonnets - are published under `@boks`, each with its
real author as the byline. Built from Project Gutenberg by checked-in scripts;
see `docs/public-domain-corpus.md`.

**The catalogue is bilingual: 906 pieces, 457 English and 449 Russian.** The
Russian half is 34 authors from Russian Wikisource - Krylov, Pushkin,
Lermontov, Tyutchev, Fet and Blok in verse, Chekhov, Averchenko, Kuprin and
Gorky in prose - published under `@boks` with the real author as the byline and
the real publication year (1786-1925) as the date. Gutenberg could not supply
it: its whole catalogue holds five Russian texts. The copyright bar is stricter
than the English one - author died before 1941, so the Russian wartime
extension cannot apply, never repressed and posthumously rehabilitated, and
every piece published before 1929, checked per piece. See
`docs/russian-corpus.md`.

It exposed two defects an English-only catalogue could not:

- **The fifteen-minute promise did not hold in Russian.** `minutes` was paced
  by words at an English word length; a Russian word is 6.06 characters against
  English's 5.44, so 115 of 449 pieces were understated, the worst by three
  minutes. `minutes` is now paced by characters, which makes the 20,000
  ceiling exactly fifteen minutes in any language and leaves the English
  estimate unchanged for 398 of 457 pieces.
- **The reader reflowed poems written in couplets.** Verse was decided block by
  block, so a stanza of two lines fell below the three-line minimum and the
  poem became two-line paragraphs. The whole body now votes once. Any poem in
  couplets broke this way in any language.

**Readers now choose their languages.** A reader is only offered boks in a
language they read. The default comes from the browser - `navigator.languages`
already distinguishes an English-only reader from a bilingual one - and the
account panel carries pills to change it, with the count of boks behind each
language. The filter lives in retrieval, not in the ranker: a piece in a
language you cannot read is not a weak recommendation, it is not one at all. A
reader whose filter empties their feed is told so and offered a one-tap way
back. See `docs/reading-languages.md`.

Shipping it turned up three defects worth remembering, each found by looking at
production rather than at the source:

- **The detector was testing for prose, not English.** It searched the raw text
  for `' the '` and required three such words; in verse almost every word sits
  against a line break or a comma, so all 437 prose pieces passed and all 20
  poems were left `und`. Normalising punctuation to spaces first, over a longer
  list of words that are not words in Spanish, Italian, French, German or Latin,
  now recognises all 457 with a clean gap to every control language.
- **`und` was treated as a yes**, so those twenty English poems were served to a
  reader who had asked for Russian only - breaking the one promise the feature
  makes. A reader who narrowed now sees only what they named; a reader who
  narrowed nothing still sees everything.
- **The nickname field was declared `name="username"` with
  `autoComplete="username"`.** Chrome filled the saved sign-in address in, the
  input normaliser stripped the `@` and the dot, and `ivanystal@gmail.com`
  became the plausible `ivanystalgmailcom` with Save lit up - one tap from
  renaming the account that publishes all 457 boks. A nickname is not a
  credential: autofill is off, and the button now names the handle it will save
  (`Save @boks_reader`) so a value the reader did not type cannot be saved
  without being read.

Real content had earlier broken three things that demo data had hidden, all now fixed:
**more than half the catalogue was unreachable** (retrieval took the newest 200
of 457, so 257 pieces could never be served to anyone); **tapping a writer's
name opened the publisher** rather than the writer; and **the reader reflowed
poems into paragraphs**. See the audit section below.

---

## Not in production

| Thing | Why |
|---|---|
| Delivery to somebody other than the account owner | Applied on 2026-09-17: production `site_url` is `https://tryboks.com`, the redirect allow-list carries both origins with their `/**` forms, and the sender is `hello@tryboks.com` on a Resend-verified domain (`tryboks.com`, eu-west-1). What is **not** proven is delivery: the Resend log shows every email ever sent went from the `onboarding@resend.dev` sandbox to the account owner's own address and nowhere else. Until a magic link arrives in somebody else's inbox, "email works" stays an assumption. |
| Inbound mail and DMARC on `tryboks.com` | No MX records, so anything a reader replies to `hello@tryboks.com` bounces; Cloudflare Email Routing would forward it. And no `_dmarc` record - not required, but Gmail and Yahoo treat a sender without one more harshly. Neither blocks sending. |
| The current reader redesign | Source Serif 4, reversible edge/gesture navigation, boundary-only vertical transitions, the simplified reaction rail, and the in-app font license are implemented and verified locally but have not been deployed. |
| Anything uncommitted | The worktree carries the current production code. There is no commit for it, so the only rollback is the previous Worker version in Cloudflare. |

---

## The recommendation system

The substance lives in three documents, in this order:

1. **`RECSYS-SYSTEM-REPORT.md`** — the whole system described for an outside
   reader: signals, strategies, instrumentation, statistics, what was wrong and
   how it was fixed, and the measured state. Start here.
2. **`RECSYS-RESEARCH-IMPLEMENTATION-PLAN.md`** — the phased plan, sections
   A–N. Phase 1 is done; Phases 2–7 are not.
3. `docs/adr/ADR-001-where-ranking-executes.md` — why ranking moved to the
   Worker.

### What is true about it now

- `for_you` is the control arm and the product ranker, ported from the original
  boks backend. `completion_first` is the challenger at 50/50.
- The challenger is **not** `recency`, which is what a young product would
  normally want. It was measured and rejected: on this corpus `for_you` and
  `recency` share 100% of their top ten for a cold reader and 80% for a reader
  with two weeks of history. `completion_first` shares 30–40%.
- Every comparison is **reader-level**. One reader is one sample however much
  they read. An interval spanning zero reports `inconclusive`, never "no
  difference"; below ten readers per arm nothing is estimated at all.
- **No experiment has produced a readable result, and none can yet.** The
  binding constraint is the corpus, not the statistics. Production carries **37
  published boks, every one of them a single minute** (76-167 words), and six of
  the seventeen signals are constants on a corpus like that - the four reaction
  signals because nobody has reacted, and both length signals because nothing
  differs in length.
- A local database usually has a boks or two more than production, from
  fixtures. Measurements quoted in the research documents were taken locally and
  are labelled as such; re-measure before citing one as a production figure.

### The honest limits

- At ~50 active readers a +30% difference in reading time is detected about 15%
  of the time. The console says so per comparison rather than printing a verdict.
- The design is between-reader, which is the weak design at this scale.
  Interleaving is in the schema but not in the serving path.
- Weights are hand-set. Nothing is trained.
- No candidate generation: every ranker sees the whole corpus.
- No semantic embeddings, and no explicit negative feedback
  (`not interested`, `hide author`). Both existed in the original backend; both
  are the cheapest remaining sources of the variance this corpus lacks.

---

## Identity, because it changed twice

Worth reading before touching anything that shows a name.

- A **person** has one name: their `@handle`. Derived from the email local part
  at sign-up, with a random suffix on collision, editable in settings. There is
  no display name.
- A **boks** has a byline, `reels.author_name`, chosen when publishing and
  defaulting to whatever that author used last time. It is a pen name and is
  *supposed* to be independent of the account: changing your nickname moves your
  `@handle` everywhere but never rewrites work you already published.
- A handle is never stored on the work. `reels.author_handle` is null for any
  boks with an account behind it, enforced by
  `reels_handle_is_never_copied`, and joined from `boks_public_identity`.
- **The profile row is created in exactly one place**:
  `getCurrentBoksUserContext` in `lib/boks/supabase-client.ts`, which calls
  `ensure_boks_user_profile` when a signed-in reader comes back without a
  handle. It used to be created only by the magic-link completion path, which
  reads a record written by the device that *asked* for the link - so a link
  asked for on a phone and opened on a laptop produced a session with no
  profile, no `@nickname`, and "@reader" on every surface. Every screen reads
  identity through that one function, so keep the guarantee there rather than
  repeating it per screen.
- **The nickname's shape is a product rule**: English letters, digits and
  underscores, 3 to 24 characters, starting with a letter. It lives in three
  places that are asserted to agree - `boksHandlePattern` in
  `lib/boks/contracts.ts`, `boks_handle_is_valid()`, and the
  `user_profiles_handle_format` constraint. Derivation from an email sanitises
  (`normalize_boks_handle`); an explicit request is refused with the rule named,
  never silently renamed.
- The byline field is prefilled from `get_my_default_author_name()`, which
  returns the author's last *non-empty* byline, or `''` if they have never
  printed one. So a first-time author sees an empty field and publishes under
  their `@nickname` alone; an author writing a series gets their pen name back
  and has to clear it to drop it.

The intermediate state — a byline silently snapshotted from the profile — drifted
and was removed. If you find yourself copying a name into another table, that is
the mistake being repeated.

---

## Deliberate product constraints

These are decisions, not omissions. Changing one is a product change.

- No passwords anywhere. Passwordless email links only.
- Readers never choose genre, mood, a catalogue item, or an algorithm.
- Language is the one exception, and it is not a preference. What you can
  read is a capability, so it is a hard filter the reader controls; what you
  like is a preference, so it stays the ranker's to infer.
- The reading surface shows no metadata about a piece: no reading-time estimate,
  no genre or mood tags. They are ranking inputs, never furniture.
- Guests read a limited number of boks, then must sign up. Guests may read
  comments; liking, commenting and following need an account.
- Every boks needs admin approval before publication. Three submissions per
  author per UTC day.
- `views` and `likes` are product features (history, like state) and are never
  used as behavioural metrics. Reader behaviour comes from
  `recommendation_events` only.

---

## Queued work

Agreed follow-ups, in the order they are worth doing:

1. **Derive genre and mood from the text - now the most valuable thing left.**
   The pickers are gone and both columns keep their table defaults, so all 457
   boks carry `literary`/`quiet` and `tasteMatch` has one bucket to learn from.
   With the whole catalogue also under one publisher account, the byline is the
   *only* diversity dimension the ranker has, and its streak penalty is a soft
   weight rather than a rule - so the feed leans hard on short verse and can
   still put three Teasdale poems together. Deriving genre and mood from the
   text, the way `reading_shape` already is, gives the ranker something to
   differentiate on and makes the experiment measurable. Consider also making
   an author streak a constraint in slate selection rather than a penalty.
2. **More Russian prose, and any Gogol at all.** The Russian load came out
   301 verse to 148 prose, because a lyric is always short and a story often is
   not: 162 candidates were refused for running past fifteen minutes, and every
   one of Gogol's short pieces was among them. The verse-heavy feed the English
   corpus already had is now more so. The fix is acquisition, not engineering -
   raise the per-author quota for the prose writers in
   `scripts/wikisource-sources.json` and re-run `npm run corpus:fetch-ru`,
   which oversamples four candidates for every piece it keeps.
3. **Move the remaining error displays onto `readableBoksError`.** Roughly
   twenty call sites still test `error instanceof Error`, which nothing thrown
   by `supabase-js` satisfies, so the database's own message is replaced by a
   generic line. Done for the account panel and the author console; follows,
   comments and reader events are still swallowing theirs.
4. **Rotate the Resend API key and re-push the SMTP password.** The key was
   pasted into a chat on 2026-09-17, which makes it exposed by this project's
   own rule, and `config push` then made it the production SMTP password -
   where the previous, unexposed key had been. Rotating in Resend breaks
   production email until the new key is pushed, so the two steps go together:
   create the new key, then `RESEND_API_KEY=... npx supabase config push` from
   a shell, never through a chat.
5. **Delete the dead `Story.likes` plumbing on the Supabase path.** It carries
   the viewer's own 0-or-1 and nothing reads it now that the action rail shows a
   like as a state. The field stays for the frozen D1 path; the `likedSet`
   argument to `mapSupabaseReelToStory` can go.
6. **Apply the sender address, then prove delivery to a third party.** The
   domain work is done and `config.toml` is updated; what remains is pushing
   it and then actually sending a magic link to an address that is not the
   account owner's. Until that arrives in someone else's inbox, "email
   works" is an assumption - the sandbox sender delivered to the owner and
   looked healthy for months.

---

## What the analytics can prove

Assessed claim by claim against the thesis title in
`docs/analytics-and-thesis-readiness.md`. In short: behavioural evaluation is
the strongest part and is reproducible from an exported CSV; cohort-awareness
is now mechanically possible and waits on sample size; the sequential dimension
was collected and unanalysed until the slate-position panel; **regression
testing is genuinely missing** - the divergence gate runs as a script and
stores nothing, so nothing can say whether a change altered ranking.

Added in this pass:

- **How much data do we need?** - the headline comparison replayed on the first
  *k* readers of each arm, so the interval narrowing is shown rather than
  asserted, beside projections of what a larger sample would buy. This is the
  answer to "how do the metrics move as readers arrive".
- **Cohort and tenure on every outcome row**, and the comparison split into
  first-week and later readers. A pooled estimate hides an arm that helps one
  group and hurts the other.
- **Slate position effects** - reading by position in the slate, per arm. Two
  arms can reach the same completion rate by retrieving better or by ordering
  better, and only position separates them.
- **Export reader rows** - the analysis unit as CSV with a note stating the
  unit and the trap, reader ids pseudonymised, so the intervals can be
  recomputed without this codebase.
- **"How this is measured"** notes on the metrics most likely to be misread,
  each saying what the number is, how it is computed, and what it is not.

The two gaps that stand between this and the thesis as titled are
**interleaving** (designed, not built - without it a 50-reader A/B resolves
nothing below about +85%) and a **stored ranker baseline** for regression
testing.

One milestone worth recording: on the 457-piece catalogue the divergence gate
now reports the arms agreeing on about 10% of their top ten. At 37 demo boks it
reported them indistinguishable, which meant no experiment could have said
anything at all.

---

## What the UX audit found

Walked end to end on the real catalogue, as a guest and as a signed-in reader.

**Works, and reads well:** landing straight into a piece with no signup wall;
read → next; the reading-limit gate at 15 pieces, which states plainly what it
is; like, comment and follow each explaining why an account is needed rather
than just refusing; the per-boks **⋯** menu, copy link and report (open to
guests, because the person whose work was taken need not have an account);
nickname, sign-out and reading history; publishing with the rights attestation.

**Fixed during the audit:**

1. **257 of 457 boks were unreachable.** Candidate retrieval was the newest 200
   by `created_at`. Nothing the ranker does can surface a piece it never sees.
   Retrieval now takes half the slate from the newest and half at random from
   everything else. Measured after: a fresh slate spans 1 to 14 minutes and 19
   writers, where before it was 1 to 2 minutes and nothing else.
2. **A writer's name led to the publisher.** Tapping "Emily Dickinson" opened
   `@boks · 457 boks` as an alphabetical dump. The byline is now two targets:
   the name opens the writer, the `@handle` opens the account that published
   them, and the publisher view is indexed by its 24 writers rather than by 457
   titles.
3. **Follow said "Follow" under a writer's name** while following the
   publisher. It now reads `Follow @boks`, with a line saying that it brings
   everything they publish, not only that writer.
4. **Every imported piece shared one timestamp**, which left the freshness
   signal nothing to read. Each piece now carries its volume's publication
   year, 1609 to 1922.

**Not a defect, worth knowing:** a reader in the completion-optimised arm sees
almost only short verse, because on a catalogue mixing one-minute poems with
fourteen-minute stories, optimising for completion means short pieces. Measured
against `for_you` in isolation, length does not affect its score at all and a
long piece after short ones is boosted. This is the experiment doing its job -
and it is far more meaningful on 457 mixed pieces than it was on 37 demo ones.

---

## Known open issues

Small, real, and written down so they are not rediscovered:

- `boks_comments.visitor_name` is a legacy alias for `visitor_handle`, kept for
  clients that have not dropped the old field. It should get a removal date.
- `minimumImpressionsPerArm` is still editable in the experiment editor and
  stored, but nothing reads it — the reader-level minimum replaced it.
- `boksOpened` is counted per day and summed, so a reader who reopens the same
  boks on two days is counted twice.
- Reading fatigue for anonymous readers is per browser, so the same guest on two
  devices has one arm and two "already read" sets.
- **Deleting an account now fails outright if any of its boks has no byline.**
  `reels.author_user_id` is `on delete set null`, and
  `reels_authorless_boks_has_a_byline` then refuses the row: `delete from
  auth.users` reports `violates check constraint`. Failing is better than the
  orphaned rows it replaced, but it means a delete-account flow has to decide
  what happens to the work first - reassign it to a publisher account, or give
  it the author's last @handle as a frozen byline. Found while clearing test
  data, not hypothetical.
- In the reader's focus mode the action buttons are `pointer-events: none`, so
  liking from a fully immersed state takes two taps.
- **A cold Worker can leave the reader on `Loading` for eight seconds or more.**
  `POST /api/feed` is the whole first paint, and it does an `order by random()`
  over the catalogue on a cold isolate. It resolves correctly, so this is
  latency rather than a fault, but it is the first thing a new reader sees and
  the catalogue is only going to grow.
- `status` in `useBoksData` is a message channel that also carried the load
  phase; `phase` now exists beside it. The ~20 remaining `setStatus(...)` error
  sites still mix notices and failures into one string.
- **Author affinity is keyed on the publishing account, so personalisation by
  author does not work at all.** `authorAffinity` is looked up as
  `profile.authorAffinity[candidate.authorUserId]`, and every one of the 906
  pieces carries the same `author_user_id` - the `@boks` account. So a reader
  who liked one Chekhov story gets an identical author affinity for every piece
  in the catalogue, Pushkin and O. Henry included. This is the same defect that
  was found and fixed for the *diversity penalty*, which now keys on the byline
  (`lib/boks/recommendations/strategies/for-you.ts`, "Author identity for
  diversity, falling back to the handle") - the affinity signal was left on the
  account. Worse, `classify()` feeds `authorAffinity` into the candidate's
  `source`, so the `discovery` family collapses for any reader with a positive
  history and the exploration machinery is effectively off. Verified in code
  2026-09-16. **Fix before any hypothesis about personalisation quality is
  measured**, because right now the personalised arm is barely personalised.
- **The read/skip label is language-dependent, and half the catalogue is now
  Russian.** `expectedReadingSeconds` is `wordCount / 238 * 60` - words at an
  English word length - while `minutes` was moved to character pacing precisely
  because word pacing is not language-neutral. A Russian word is 6.06
  characters against English's 5.44, so for the same amount of text a Russian
  piece has ~10% fewer words, a lower `expected`, and earns `complete` on less
  actual reading. Every metric built on this label is biased between languages.
  The label also ignores `reading_shape` although 477 of 906 pieces are verse,
  which is read more slowly per word than prose. This matters more than it
  looks: the label is the proposed primary outcome metric for the thesis.
- **`coldStartPrior` is called with the piece's own `createdAt` in the `now`
  position** (`for-you.ts:511`, inside `explorationBudgetBoost`), so
  `days` is always 0 and the `followers <= 30 and days <= 14` branch is
  vacuous - a five-year-old piece looks as new as one published today. The
  other call site passes `now` correctly.
- **No popularity baseline in the strategy registry.** Registered:
  `for_you`, `balanced`, `completion_first`, `discovery`, `taste_match`,
  `reaction_first`, `recency`, `random_control`. MostPop is the baseline a
  recsys reviewer expects first and is often hard to beat; its absence is a
  methodological gap for the thesis, not just a missing feature.
- **`RECSYS-SYSTEM-REPORT.md` §16-17 is stale by an order of magnitude** - it
  reasons about 38 published pieces where there are now 906, so its arm
  divergence table and its justification of the live split are no longer valid.
- **A per-boks share link does not open the boks it names.** `/b/<id>` and
  `/?bok=<id>` both serve whatever the ranker put first instead - always the
  same piece, whichever id is asked for, so the id is being discarded rather
  than mis-resolved. Verified on production for an English piece and a Russian
  one, so it is neither language- nor corpus-specific, and nothing in the
  reading-languages or corpus work touches this path. The redirect itself is
  fine: `app/b/[id]/page.tsx` rewrites to `/?bok=<id>` correctly, and the
  reader does read `params.get("bok")`. The failure is between that read and
  `openReadBoks`, which is called through `openReadBoksRef` late in the init
  chain - the two candidates are a stale closure (`rankedStories` still empty,
  so it takes the `loadSupabaseStory` path) and the `pendingLibraryStoryId`
  effect never finding its index. This is a shipped feature - every boks offers
  the link - so it is worth fixing before a pilot.
- **A bilingual reader is served about two English pieces for every Russian
  one** (measured in the candidate pool: 132 to 68). Each piece carries its
  real publication year so the freshness signal has 115 distinct years to read,
  and the English corpus was printed 1906-1922 while much of the Russian is
  19th century - so the "newest half" of retrieval skews English. The random
  half balances it and a reader who names one language is unaffected, but the
  feed is not evidence of a language preference until this is accounted for.
- **Genre and mood are no longer chosen by anyone.** The submission form lost
  both pickers, and the columns keep their table defaults (`'literary'`,
  `'quiet'`), so every new boks arrives with the same pair. `tasteMatch` in the
  ranker is built from a reader's genre and mood affinity, so that signal now
  has one bucket to learn from and goes flat as the seed catalogue is diluted.
  The fix is to derive both from the text, the way `reading_shape` already is -
  not to put the pickers back.
- **Most database refusals are still swallowed on screen.** Nothing thrown by
  `supabase-js` is an `Error`, and roughly two dozen call sites test
  `error instanceof Error ? error.message : "Could not ..."`, so the message the
  RPC wrote is replaced by a generic line. `readableBoksError` in
  `lib/boks/errors.ts` fixes this, and is wired into the account panel and the
  author console - the two places a refusal is aimed at a reader. The remaining
  sites (follows, comments, reader events) should move to it too.
- `mapSupabaseReelToStory` still fills `Story.likes` with the viewer's own
  `0 or 1`, which nothing reads now that the action rail shows a like as a state
  rather than a count. The field stays because the frozen D1 path fills it with
  a real total; the Supabase side of the plumbing (and the `likedSet` argument)
  can go.

---

## Where to start, by task

| Task | Read |
|---|---|
| Get a local environment working | `docs/local-environment-runbook.md` |
| Deploy, or manage services | `docs/local-agent-infrastructure.md` |
| Change the recommender | `RECSYS-SYSTEM-REPORT.md`, then the plan |
| Add or change a metric | `docs/admin-metrics.md` |
| Change product scope | `specs/boks-product-spec.md` |
| Pick up in-flight work | the newest file in `docs/handover/` |
