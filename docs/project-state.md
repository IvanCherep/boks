# Where boks Stands

The standing summary: what is live, what is not, and what is known to be open,
newest first. A new session reads this after `CONTEXT.md`. Updated 2026-10-14.

For *why* a thing is the way it is, `docs/adr/` and the handovers are the
record. Test, check and migration counts are deliberately not kept here - they
go stale in a day; run the commands in `AGENTS.md` for current numbers.

---

## Live

**Byron's *Napoleon's Farewell* (2026-10-14).** From
`byron_napoleons_farewell_boks.zip`, pictures in numerical order, brief in
`docs/poetry/napoleons-farewell/brief.md`. Added to the catalogue (bok
`abbf65a4-b64b-4d8d-aa92-2f3aee583b5a`, `work/catalogue-2026-10-14b/`, the
1904 Coleridge/Prothero text) and embedded. Julian reads it; both takes were
word-perfect by STT, the first ships, with pauses between stanzas and at each
change of picture, at −22.57 LUFS; theme 13 dB under (gain 0.108), zero
words. A new hold, `recall-glory`: the vision painted into the clouds - the
coronation in the first picture, the eagle over Saint Helena in the last -
is storm grey at rest and comes back in gold while held. Looked at in WebKit
at iPhone 15 size against the built app; the checker now stubs the analytics
calls, since local runs write to the production tables.

**Four poems with gestures for the investor set (2026-10-14).** From
`boks_investor_poems.zip`, pictures in numerical order, briefs in
`docs/poetry/<slug>/brief.md`. Longfellow's *The Arrow and the Song* (bok
`45035e98-5bbf-4f3f-bb1b-f88f2bc02ac2`) and Dickinson's *There is no Frigate
like a Book* (bok `7cf8f28a-3d1a-49df-a4bb-b10a274e5347`, the 1896 *Poems:
Third Series* text, not the later dashed one) added to the catalogue
(`work/catalogue-2026-10-14/`, `CATALOGUE_MIN_CHARACTERS=150`) and embedded;
Whitman's *A Noiseless Patient Spider* (bok
`011660ae-2795-4b28-bd77-0404a4a2a8ba`) was in the catalogue and gained its
production; *Invictus* was already a poem and was redrawn on the new pictures
with its own recording and theme. Jerry B. reads the three men, Sha
Dickinson; new takes at −22.45 LUFS, silence inserted where a gesture needs
room (Dickinson's lines run together, so one cut is placed by hand in the
waveform between «book» and «To»); themes 13 dB under, zero words. New
gesture kinds - `fling`, `threads`, `shelter-flame`, `swipe` - and scene
`ambience` (rain, the returning song), all in `docs/reading-formats.md` §
Scene gestures, plus a `page-turn` transition. Looked at in WebKit at iPhone
15 size against the built app with real pointer gestures; frame rate not
measured. Reduced motion stops the rain and the returning song but leaves the
gestures as gestures, not taps.

**Two Australian poems with scene gestures (2026-10-13).** Christopher
Brennan's *Because She Would Ask Me Why I Loved Her* (bok
`e07795ca-f5ee-4472-8646-f9dc64736c91`) and Bernard O'Dowd's *Australia* (bok
`8e2ae832-c00c-43f0-ba4b-0acd5653df03`) were not in the catalogue and were
added by the curated route (`work/catalogue-2026-10-13/`; O'Dowd from
Wikisource, Brennan from PoemHunter - Brennan d. 1932, O'Dowd d. 1953 and the
sonnet published 1900), embedded, and produced as immersive poems from the
four Sydney and four Melbourne pictures in numerical order. Jerry B. reads
both (Australian authors: no British voice by rule), take 1 of 2 each, at
−22.4 LUFS; themes take 2 of 2, zero words in speech-to-text, 13 dB under.
New: **scene gestures** (`docs/reading-formats.md` § Scene gestures). On
Brennan's second picture, holding the screen draws the two reflections
together and stills the water, releasing restores the ripples; on O'Dowd's
second, moving sideways leans the landscape into Eden or into its industrial
counterpart and it returns to the ambiguous middle when released. O'Dowd
also gets `transitionStyle: "cinematic"`. Looked at in WebKit at iPhone 15
size against the built app (seeked by the bar: headless WebKit does not
decode the MP3s, for the shipped poems either); frame rate not measured.
No events record the gestures yet.

**Song of the Redwood-Tree, Part 1 on the series shelf; the British voice
brought up to level (2026-10-11).** Whitman's Part 1, bok
`dc5150c6-fb9b-417c-8b29-40d274103acc`, added by the curated route
(`work/catalogue-2026-10-11b/`, the 1882 text on Wikisource; the Whitman
Archive transcription the brief names is behind a bot wall) and produced as an
ordinary immersive poem from `docs/poetry/redwood-tree/`: Jerry B., take 2 of 2
(more silence, slower), 0.7 s more breath before «Farewell», 1.8 s after the
end, voice at −22 LUFS; theme take 3 of 3 at 16 dB under (0.111), as the brief
asks for a near-silent drone. The first theme shipped for minutes came back
249 s of 380 after a rate-limit retry; `shipped-poems.test.ts` now fails a
theme shorter than its voice. Not built: the hold-the-bark reveal, forest
ambience and its events. The Binsey Poplars and Grantchester readings had
shipped at −30 LUFS against the series' −22 and were raised to −22.9 and
−22.7 (gain and a peak limiter only; timings unchanged); the narration level is
now a step in `docs/reading-formats.md` § Adding a poem.

**The Old Vicarage, Grantchester on the series shelf (2026-10-11).** Rupert
Brooke's poem, bok `afa5a1ed-3019-455e-b550-475c9a498db3` (already in the
catalogue), produced as an ordinary immersive poem from the four pictures and
brief in `docs/poetry/grantchester/`. The complete poem, not selected passages;
the Berlin dateline is not read. Julian, take 1 of 2 (more silence); 0.7 s
inserted before «Stands the Church clock» and 1.8 s of silence after the last
line, as the brief asks - the untouched alignment is `alignment.raw.json`.
Theme take 1 of 2, 16 dB under the voice (gain 0.035) because the brief wants
an almost imperceptible bed; `shipped-poems.test.ts` now allows gains down to
0.03. Not built from the brief: the wipe-the-glass reveal, rain/river ambience
and its reveal events (the poetry format has no gestures), and the historical
note it suggests for the poem's dated lines («Temperamentvoll German Jews»).
The reading runs at ~142 wpm against the brief's 105-115; the model ignores
speed.

**Binsey Poplars on the series shelf (2026-10-11).** Hopkins's poem, bok
`99ee280f-faf5-4026-99fc-9cbec9d79a2a`, added to the catalogue by the curated
route (`work/catalogue-2026-10-11/`, text from the 1918 edition on Wikisource)
and produced as an ordinary immersive poem: four pictures, read by **Julian**,
the first British voice in `voices.ts` (British classics, male), theme take 1
of 2 at gain 0.092. The recording has 0.8 s of silence inserted before «All
felled» so the second picture holds longer than 3.5 s; the untouched alignment
is `docs/poetry/binsey-poplars/alignment.raw.json`. The touch-and-hold, ambience
and research events from the original brief (`docs/poetry/binsey-poplars/brief.md`)
are not built: the poetry format has no gestures, and adding one is a
scene-map field in the existing renderer, still to decide. The whole-table
re-spread of publication dates (`docs/catalogue-import.md` §4b step 3) was not
run; the new bok carries a synthetic date inside the 30-day window.

**Tracked links (2026-10-11).** For sending boks
to universities: the admin console's **Links** tab makes a link per place - a
label ("MSU, philology"), usually a bok, a code - as `/b/<id>?link=<code>` (or
`/?link=<code>`), and reports per link: visits, arriving devices, where they
came from, who opened and finished the bok, opened its production, read
another, came back, signed up, median minutes. Below it, the same outcomes per
landed bok for every shared-bok visit. Visits now also record the bok they
landed on (`landing_reel_id`) and the series shelf as a landing. Migration
`20261011100000_boks_tracked_links.sql` (replaces `record_boks_journey_event`
with two new trailing defaults; tabs already open keep working), RPCs
`create_tracked_link`, `set_tracked_link_archived`, `get_link_attribution`;
metric definitions in `docs/admin-metrics.md` § Links. Migration pushed to
production first, then the Worker deployed as version
`71c8e029-c9b8-4223-a8eb-3eacc3c318ee`; verified: every page 200, `POST
/api/feed` 401 without a token, `verify:supabase` all true, and the new
admin RPCs refuse a bare request with 42501.

**Recording text clears the Reels header (2026-10-08).** In immersive poems,
`?recording=true` (also `?recording=1`) places text zones at least 16% down
the frame. Zones already lower keep their position, and ordinary playback
keeps the original scene composition. Checked all 20 poem manifests in WebKit
and Chromium at three phone sizes and a desktop size.

**Recording mode for the formats (2026-10-05).** `?recording=1` on a reader
address opens cinema and immersive poems without close button, progress bar or
transport, for admins only, so a piece can be screen-recorded. Keys: Space,
arrows, Escape. See `docs/reading-formats.md` §5.

**A full audit, and the fixes from it (2026-10-05).** Code, schema and docs
were audited end to end and the defects fixed in one pass. Migrations
`20261005100000`-`20261005113000` were pushed to production first, then the
Worker was deployed as version `26765e2c-dfe6-42c9-8e8d-7eb5c971b844`.
Verified on production: `verify:supabase` all true against the new schema,
every page 200, `POST /api/feed` 401 without a token and a Worker-ranked,
non-degraded `ranking.v2` slate with one, an aftertaste event recorded while a
malformed event in the same batch was dropped alone, `boks_public_identity`
refused to a session, `boks_comments` still readable. One aftertaste row with
`metadata.agentCheck = true` is from that probe. What a reader or the founder
would notice:

- **Aftertaste was being dropped.** Since 1 October every aftertaste event was
  silently filtered out by the ingest function, which kept its own copy of the
  event-type list. Migration `20261005100000` makes one list
  (`boks_recommendation_event_types()`), and `checks.sql` asserts it equals the
  table's CHECK constraint. Nothing recorded before the fix can be recovered.
- **Ranking `ranking.v2`.** Every algorithm now reads the reader's server-side
  history for fatigue and novelty (challengers used to see only the browser's,
  so a second device ranked as a stranger); `for_you`'s exploration budget ages
  a piece against serving time, not its own creation time; a stored arm naming
  a strategy this build lacks is attributed to the one that actually ranked.
- **The D1 compatibility path is gone** (`docs/adr/0013-remove-d1-compatibility-path.md`).
  Production could never reach it - `wrangler.jsonc` has no D1 binding.
- **Schema hardening** (`20261005110000`, `…112000`, `…113000`). A bad event
  no longer aborts its batch; the arm an event or served feed is credited to
  comes from the reader's stored assignment, not the browser's claim; the
  candidate query has an hourly ceiling and its hot-path indexes; the lab,
  overview and guest funnel count per reader and per active experiment; the
  author quota's day is cut in UTC and `resetsAt` carries an offset. **A
  reader with any like, comment or follow could not delete their own account**
  - the cascade hit the suspended-account trigger and rolled the deletion back;
  fixed. A profile can no longer be inserted directly (bypassing reserved
  handles and terms), `boks_public_identity` no longer lists every account,
  and `is_boks_admin(uuid)` / `is_boks_user_blocked(uuid)` no longer answer a
  reader about someone else. Deliberately left: raw `reels`/`comments` SELECT
  for signed-in sessions, nullable `rank`, cascade deletion of experiment
  history with an account, tighter rules on `likes`/`views` writes.
- **Reader telemetry.** The first slate of a page load is ranked with the
  stored profile (it used to be ranked with an empty one); `rank` and `feedId`
  are the position and feed that actually served the bok; boks the reader chose
  (shared link, library, author page, series shelf) carry `metadata.entry`;
  time in a reading format carries `metadata.format`; the `exit` outcome is
  sent with keepalive; the event queue sends at most 50 per call and drops a
  permanently refused event instead of blocking every later batch; the
  reading clock no longer runs under the series shelf or in a background tab.
- **Reader UX.** An open poem blocks feed navigation; the 15-read guest wall
  also applies to reading formats; a failed first load no longer leaves a
  signed-in reader treated as a guest; storage that throws no longer blanks
  the reader. Menu, feedback, empty-feed and action-rail pieces moved out of
  `reader-feed.tsx` into `components/boks/reader/`.
- **Worker feed.** Config, candidates and catalogue count load in parallel
  with a 3 s per-call timeout; a 401 refreshes the session and retries
  instead of opening the breaker; the degraded path honours reading languages
  and keeps author spacing; no database error text reaches clients or
  `served_feed`.
- **Recommendation lab.** Effect, interval, p-value and power now all measure
  the same thing (difference in means) - they could disagree before; each rate
  has one definition (`lib/recsys/aggregate/metrics.ts`); crossed readers are
  excluded from arm totals; cohorts classify each reader once; readiness is
  readers per arm, per metric, editable in the experiment editor; the shared
  fatigue rule applies after a strategy's own rerank unless it declares
  `handlesFatigue`; `verify:divergence` ranks with the same candidate mapping
  production uses. The author quota trusts the server's `remaining`.
- **Documentation for agents:** a glossary (`CONTEXT.md`), numbered ADRs in
  `docs/adr/` (the old `docs/decisions/` merged in), a short `AGENTS.md` that
  `CLAUDE.md` imports, the module map in `docs/architecture.md`, GitHub Issues
  as the tracker (`docs/agents/`), and the research reports under
  `docs/research/`. `docs/ai-agent-guide.md` and
  `docs/future-updates-playbook.md` were folded in and removed.

**Two sections, feed and series (2026-10-04).** The reader has two tabs. The
feed (`/`) is unchanged and holds every boks. The series tab (`/series`) is
the shelf of pieces produced in the new formats - 20 today, 10 English and 10
Russian, 19 immersive poems and Tolstoy's «Лев и собачка» in the cinema
format. Every one of them is also in the feed, where a "boks series · listen
to the production" mark above the title and the clapperboard button open it,
for every reader, guest or signed in. The shelf filters by the reader's
reading languages, and reads opened from it carry `entry: "series"` in event
metadata so an algorithm comparison can leave them out. The interface is
English everywhere; pieces keep their own language. Production and the steps
to add a piece: `docs/reading-formats.md`.

**https://tryboks.com** — Cloudflare Worker `read`, attached as a custom domain
on 2026-09-17. The zone is registered through Cloudflare Registrar in the same
account, so no nameserver change was needed.

The security-audited build was deployed on 2026-09-26 as Worker version
`9b1546e9-e453-4858-adf5-b73445243aa0` and smoke-tested on the custom domain.

`https://read.tryboks.workers.dev` still runs the same Worker, but since
2026-09-22 **every page on it redirects (308) to the same path on
tryboks.com** (`proxy.ts`, rule in `lib/boks/canonical-host.ts`). Keeping it
reachable was a bug, not a courtesy: a sign-in link returns to the address it
was requested from, and a session lives in one address's storage, so a reader
who landed on the old host signed in there and stayed signed out on
tryboks.com. Found in the auth log - the link request for a real account came
from `read.tryboks.workers.dev`, the link went back there, the account never
appeared on tryboks.com. `/api/` and `/_next/` are left alone so a tab already
open on the old host keeps working. Production auth's `site_url` is
tryboks.com (checked in the dashboard; an older note here said otherwise), and
the redirect allow-list keeps the old host only for links already sent. Two
things to know about it:

- **`workers_dev` has to be declared in `wrangler.jsonc`.** Omitting it defaults
  it to false, and the first `wrangler triggers deploy` turned the workers.dev
  subdomain into a 404. Caught in the same minute; the flag is now explicit.
- **`www.tryboks.com` is deliberately not attached.** A second custom domain
  would serve the app from a second origin, and an origin is a separate browser
  storage bucket - sign in on one and the other still looks signed out. `www`
  belongs behind a zone-level redirect rule to the apex. Production backend is the Supabase project
`vcmrvnihbptostnzaean` (eu-west-2).

Every migration in `supabase/migrations/` is applied to production (check with
`npx supabase migration list --linked`). The production database is on the
current schema, which means **older client code will not work against it** —
`user_profiles.display_name` no longer exists, and code that reads it breaks.
Deploy from current source rather than rolling the Worker back on its own.

Deployed and working: the reader, the `for_you` ranker behind `/api/feed` with
served-feed provenance, author pages and follows, per-boks and per-author share
links, the lazy-loaded partial/full-screen comment sheet with one-level replies
and per-comment likes, handle-only identity, and the admin console.

**Security boundary audit (2026-09-26).** The review covered the 301-file,
roughly 74k-line expansion since the original baseline, the dependency tree,
public Worker routes, Auth configuration, every Data API grant, RLS/RPC
authority, Supabase Advisors, and production headers. Runtime dependencies were
updated and exact-version pinned; `npm audit` is now 0. Reader routes can no
longer choose an experiment arm, API JSON is stream-limited, internal database
errors do not reach clients, and the D1 compatibility endpoint can no longer
publish or impersonate a commenter. Production now sends CSP, HSTS, frame,
MIME, referrer, and permissions headers.

Migration `20260925160420` wraps high-volume feed/event RPCs with size, batch,
metadata, and hourly limits; requires terms for social/author writes; removes
bare-anon telemetry writes; closes browser first-admin claiming; and supplies
all missing foreign-key indexes. Auth now confirms email, disables manual
linking, and rejects leaked passwords. Verified with the unit tests, the schema
checks from a clean database, production RLS probes, Advisor review, build, and
live header/API checks. `docs/security.md` is the standing threat model and
records the intentional Advisor exceptions and remaining CAPTCHA/CSP work.

**Admin governance is database-backed end to end.** Content has separate
Published and Deleted views. Delete first archives a boks with an actor, time,
and reason; restore requires a confirmed rights record; permanent deletion is
available only from Deleted and requires the exact title. People can grant and
revoke admin access, suspend and restore accounts with a user-visible reason,
or permanently delete a non-admin account after typing its exact nickname.
The acting admin and the last active admin are protected. Account deletion
anonymises and archives authored boks, deletes personal and reaction data, and
leaves only a UUID tombstone so a stale JWT cannot write until it expires.

**One inspector for the whole console (2026-09-19).** Any boks in Moderation,
Rights or Content, and any account in People, opens in the same side sheet:
a boks view (text, review and hide history, rights, metrics, newest comments
and likers) and a person view (reading and authoring metrics, 30-day
activity, and the boks they wrote, liked, commented on and read, with a JSON
export). Links inside it walk between the two with Back. Reads are
`get_admin_bok` / `get_admin_person` (migration `20260919220000`), with metrics
defined exactly as the Content and People rows - `checks.sql` asserts equality.
Hide / restore / erase have one dialog, `admin/bok-lifecycle-dialog.tsx`.

**A blocked API host no longer looks like a broken app (2026-09-21).** A
reader in Russia reported a white screen without a VPN and a connection error
with one. The white screen was ours: the page is a "Loading" shell and the
first thing the client does is call `…supabase.co`, that call had **no
timeout**, so on a network that blocks the host the app sat on the word
"Loading" indefinitely. Now the boot is bounded at 8 s
(`lib/boks/network-errors.ts`, `withUnreachableTimeout`), a network failure is
told apart from every other error by what browsers actually say ("Failed to
fetch", "Load failed", "net::ERR_…", and our own marker), and the reader gets a
screen that says the page loaded, the connection after it did not, that another
network or a VPN usually fixes it, with **Try again** and the support address.
Verified by building against an unreachable host and watching it: 8 s, then the
screen.

**Guests: who they are and where they stop (2026-09-22).** The founder's
question was "we bring people and nobody registers - why?", and the reading
events could not answer it, because the moments that decide it are not reading
moments. Three are now recorded in `boks_journey_events` through
`record_boks_journey_event` (open to authenticated anonymous guests, silent on anything it does not
recognise): a **visit** once per session with its landing (home or a shared bok
link) and source (referrer host, utm tags), a **sign-up prompt** with its reason
(the 15-bok limit, like, comment, follow, the guest notice, the account button)
and a **link request** with the same reason. The `/b` page carries the referrer
and the utm tags across its redirect as `ref` and `from=share`, because a
redirect drops them; the reader captures them before it cleans the address bar,
and sends the visit only once the reader's identity has settled, so a
signed-in visit can never be counted as a guest's.

`get_guest_funnel` (admin-only) counts by **device**, not by person or by
anonymous user. The device id survives sign-up while the anonymous user is
abandoned, so a device with both an anonymous and a real account in its history
is a guest who converted - measured before building on it: all 492 reader
events carried a device id, and two devices already showed the conversion.
The console's **Guests** tab shows the funnel (arrived -> started reading ->
finished one -> finished three -> saw the sign-up -> asked for a link ->
created an account), names the step that loses the most, and breaks it down by
reads per guest, the limit, the wall each guest met, sources and day.

The first reading of it, on 14 days of production data: 26 guest devices, 24
started reading, **3 finished a single bok**, median guest reading time **24
seconds**, and nobody reached the 15-bok limit. Caveats it states itself:
finishing was only recorded correctly from 21 September, prompts and sources
only from 22 September, and the team's own testing is inside every number. But
the shape is already clear enough to act on: guests leave before any sign-up
wall is shown, so the wall is not what is losing them.

**Countries, and telling the team from strangers (2026-09-22).** Two
questions the Guests tab could not answer: where the audience is (which decides
the next reading languages), and which visitors are the team - two developers
in Serbia test daily, and at 1-5 real newcomers a day a developer's private
window looks exactly like a stranger.

The country comes from Cloudflare, which adds `CF-IPCountry` to every request
the Worker receives; `/api/geo` returns just the two-letter code (`XX` and Tor's
`T1` become nothing), the reader attaches it to the visit, and the IP address is
never read or stored. Verified before building on it: the probe answered `RS`.
Team devices are recognised automatically - any device ever used by an admin
account, over all time, including what it did as a guest before the admin
signed in - and by hand through `boks_team_devices` ("Mark this browser as the
team's" in the tab). What neither can see, a private window or a cleared
browser, is what hiding a country is for: click a country in the new "Where
they are" table and every number on the page leaves it out; the choice is
remembered per admin browser. `get_guest_funnel(days, include_team,
hide_countries)` excludes the team by default and applies both filters at the
source, so the funnel, the daily table and new accounts all agree.

On production right after the deploy: 3 team devices recognised automatically;
27 guest devices without the team, 28 with it, 26 with Serbia hidden. Devices
seen before today show as "unknown" - countries start now. Privacy states the
new field.

**Licences and terms, audited (2026-09-22).** Three findings, all fixed:

- **Only the font's licence was published.** Everything else boks ships to a
  browser is open source under MIT, ISC, BSD or Apache-2.0, and each of those
  asks that its notice travel with copies - which a minified bundle is.
  `scripts/build-third-party-notices.mjs` now writes
  `/licenses/third-party-notices.txt` from the real installed tree (183
  packages, nested copies included) plus the build tools compiled into the
  pages, linked from Settings -> About. It **refuses to run on a copyleft
  licence**, and it caught one on its first run: `sharp`'s libvips binary,
  LGPL-3.0, pulled in by `next`. It is never distributed - a Worker cannot load
  a native binary - so it is excluded with a reason, and the script greps
  `dist/` for it, so the exclusion stops working the day it is bundled.
- **Two authors may still be protected in Russia.** The 70-year rule plus the
  four-year wartime extension (Civil Code art. 1281(4)) protects Bunin until the
  end of 2027 and Teffi until the end of 2026. 21 texts hidden through
  `archive_bok` with the reason and restore date; 526 remain published. The
  other 65 Russian authors were checked against the extended rule and are clear.
- **The Terms said nothing about the catalogue, copyright complaints, feedback
  or liability.** They now cover where the texts come from and what "public
  domain" does not promise across borders, a notice-and-takedown procedure
  (hide on report, tell the publisher, remove if it holds, close repeat
  infringers), acceptable use including bulk copying, a free licence to use
  feedback, a minimum age of 16, an "as is" disclaimer and a limitation of
  liability to the extent the law allows, and how the Terms change. Privacy
  now lists feedback as data, says how recommendations are computed, how long
  things are kept, and the age rule. Governing law is deliberately absent: it
  depends on the legal entity that operates boks.

**Author taste now follows the writer, not the publisher (2026-09-21).**
`authorAffinity` was keyed on `authorUserId`, and this catalogue is 547 pieces
by 138 writers under one account - so there was one key for everything: the
likes of Chekhov, Blok and Grin landed in a single counter answering "does this
reader like @boks", identical for every candidate and therefore unable to order
anything. Measured on 200 live candidates: one distinct `authorUserId`, 97
distinct bylines. Author personalisation was dead while looking alive.

The profile and the ranker now share one identity, `authorIdentityKey` in
`reader-profile.ts`: the byline where there is one, the account behind it for an
author who publishes their own work. Following stays on the account, which is
right - a reader follows a publisher. Author spacing already used this rule, so
the slate is unchanged; the test that proves the fix fails against the old
keying, and a second test holds the spacing (one writer still cannot take three
slots in a row). Still keyed on the account and still therefore constant:
`authorTrust` and the cold-start priors, which would need a byline aggregation
in `get_recommendation_candidates` - a separate, optional step.

**A tab icon, and a shared bok that previews (2026-09-21).** Every icon and the
share cover are built from one master, `assets/brand/boks-logo.png`, by
`scripts/build-brand-assets.py` into `public/`: 16/32/48 PNGs, a 16/32/48
`.ico` for the browsers that still ask (Yandex Browser among them), 192 and
512 for the manifest, a flattened 180 for iOS, and `og-cover.png` at 1200x630.
The cover is built rather than cropped - the background is the logo's own
gradient taken from the strip above the wordmark, the tile sits on it whole -
because a centre crop of a three-row wordmark cuts it in half, and because
Telegram, WhatsApp and Slack give a wide image a large preview and a square one
a thumbnail. The old `favicon.svg` is unreferenced: a stacked wordmark is
unreadable at 16 px in any format.

**`/b/<id>` is server-rendered now, and that was the whole problem.** It used to
be a client-side redirect, so the HTML a messenger fetched carried no title, no
description and no image: the most shareable thing in the product, one short
poem, arrived as the bare word "boks". The route has `generateMetadata`, reads
the piece with the publishable key from `published_boks` (so a draft or a hidden
bok cannot reach a preview by construction), and returns `og:title` as
"Title — Author", `og:description` as the opening 200 characters run into one
line, `og:type: article` and the cover. Bounded at 2 s and swallowing every
failure - a preview is never worth a broken page - with a generic fallback for
an unknown id. A person still lands in the reader: the redirect moved into a
client child, `open-shared-bok.tsx`.

Verified on production with Telegram's user agent: "Незнакомка — Александр
Блок" with Blok's first lines, absolute image URLs, every asset 200, an unknown
id answering 200 with generic tags, and the shared link opening that exact bok
in the reader.

**The share button was damaging its own links (2026-09-22).** It handed the
system share sheet both a text ("Read "Конкурс" on boks") and the URL, and
Telegram joined them with no space - `/b/<id>Read "Конкурс" on boks` - then
linked everything up to the first space. The id arrived as `…cdfbd26Read`,
matched nothing, and the card was the bare word "boks": every link shared from
the button previewed as nothing, however good the preview behind it. Fixed on
both sides. The button sends the URL alone (the preview already carries the
title, the writer and the opening, so nothing is lost), and the copy fallback
copies the URL alone. And the server reads the id as the UUID a path segment
*starts with* (`sharedBokIdFrom`), so the links already sitting in chats
preview correctly and open the right bok; `og:url` stays the clean one.

**One caveat for whoever shares a link today:** Telegram caches a preview per
URL, so a link shared before this deploy keeps its empty card. Sending it to
`@WebpageBot` refreshes it.

**Poetry could not be finished, and that was measured (2026-09-21).** A reader
noticed that nothing was ever marked as read. Production agreed: in 24 hours,
**37 skips to 4 completes**, and the skips averaged **9 seconds of foreground
attention at 38% progress** - people reading, recorded as people leaving.

Two causes, both in the outcome rule. A bok that fits the screen has nothing to
scroll to, so its progress stays 0 however carefully it is read
(`reader-feed.tsx`, `updateStoryProgress`), which left only the strictest
branch - 70% of the expected time - and the expectation had a 20-second floor,
so a 30-word quatrain needed 14 seconds, about twice what reading it takes.

The fix keeps `progress` meaning what it meant, because the ranker pays for
prior progress and treats a part-read piece as one to resume: telling it every
short poem was read to the end would push flicked poems up the feed. Instead
the outcome now receives the fact it was missing - whether there was anything
to scroll (`inferReadOutcome(..., { scrollable })`) - and judges an
unscrollable piece on attention alone, which is the only evidence it has. The
floor drops 20 -> 12 seconds. A quatrain now counts as read after 5 seconds on
screen and is still a flick at 3. Scrollable pieces are judged exactly as
before, which a test asserts.

Left alone deliberately: the skips already recorded. They are a measurement,
wrong but real, and rewriting them would be worse than carrying them; they feed
`for_you`'s skip penalty and fade as new events arrive, and the taste vector
never read them (it is built from likes and completes).

**The blocking hypothesis was wrong, and two real defects took its place
(2026-09-21).** The reader was asked to open the API host directly and got
`{"message":"No API key found in request"}` - which is PostgREST answering
correctly. The host is reachable from his network, so nothing is blocked, and
the blank screen was a crash rather than a timeout. Two causes, both ours:

- **There was no error boundary anywhere in the app.** Any exception while the
  reader booted left the page blank - no message, no retry, nothing anybody
  could report. Added `components/boks/error-boundary.tsx` around the reader,
  the author console and the admin console: it says the app stopped rather than
  the network, offers a reload, and puts the error name, message and user agent
  behind a "What went wrong" disclosure so a crash that only happens on someone
  else's browser can be pasted into a message to support.
- **`crypto.randomUUID()` was called unguarded while booting**
  (`getBrowserId`, the reader's session id, the author console's). It needs a
  **secure context** and Chromium 92+, so it is missing over plain HTTP and in
  some proxying or in-app browsers - Yandex Browser's traffic-saving mode among
  them - and a throw there was a blank page. `lib/boks/browser-id.ts` falls back
  to `getRandomValues` and then to a timestamp; these ids are labels, not
  secrets. 5 tests, including "never throws, whatever the browser does".
- Also hardened: the Supabase auth store now tolerates a `localStorage` that
  throws (blocked site data, private windows, in-app browsers) by falling back
  to memory, rather than rejecting `getSession()` mid-boot.

**An operational note worth knowing before a launch day:** for a few seconds
after `npm run deploy`, a page load can be served HTML that references chunks
the edge has not received yet, and vinext then shows "This page couldn't load".
Seen once during this pass and gone on reload - all chunks answered 200 from
the server at the same moment. It also means some of what this reader saw today
may simply have been one of the eight deploys. Deploy when nobody is reading,
or expect one reload.

**Still open, and the actual fix for readers behind a block:** the browser
talks to `vcmrvnihbptostnzaean.supabase.co` directly for auth and every RPC, so
one blocked host takes the whole app down for that reader - `/api/feed` needs a
token, and the token comes from the blocked host. Either Supabase's Custom
Domain add-on ($10/month) on `api.tryboks.com`, or proxying the REST and auth
paths through our own Worker on the zone that already reaches them. Owner's
call; the second costs nothing but is ours to maintain.

**Readers can say what they think, without an account (2026-09-21).** A text
box, and nothing else: no mail client, no sign-up, no form to fill in. It
appears in two places - Settings -> **Send feedback**, open at any time, and a
sheet offered after the 3rd, 10th and 30th bok **actually read** (a `complete`
outcome, so foreground reading time, not boks that crossed the screen). Each
milestone is offered once; a reader whose count arrives already past one - a
second device, a cleared browser - is asked once about where they are rather
than walked through three prompts (`components/boks/feedback.ts`, 6 tests).

The point of the design is that it costs a reader nothing:
`submit_boks_feedback` accepts the anonymous Supabase session the reader already
has, so no permanent account is required; bare publishable-key calls without a
session are refused. The device visitor id still groups notes instead of a
name. Five notes an
hour per account or device, 2-4000 characters, and a suspended account is
refused. Nothing but an admin can read them: the table has row-level security
with no policies, and `get_boks_feedback` checks `is_boks_admin()` - a note may
be about another reader, or about whoever runs this. The inbox is the admin
console's **Feedback** tab, newest first, each note beside where it was written
and how many boks that reader had finished. `support@tryboks.com` stays
reachable but is deliberately quieter than the box: opening a mail client is
work, and work is how feedback stops arriving. Migration `20260921100000`; 8
assertions in `checks.sql` cover the guest path, the rate limit and the fact
that a reader can read nothing.

**The ranker has a semantic source, and the catalogue is new (2026-09-20).**
The full account, with the measurements behind every choice, is
`docs/handover/2026-09-20-embeddings-and-catalogue.md`. In short:

- `reels.embedding` is `vector(384)` (pgvector, HNSW cosine).
  `get_recommendation_candidates` returns `tasteSimilarity` (against the mean
  embedding of what the reader liked or finished) and `noveltyDistance`
  (against their last 24 reads), both computed in SQL because 200 candidates
  times 384 floats is half a megabyte per request. `for_you` scores a
  candidate's **standing within its set** (a z-score), never the raw cosine,
  and labels the top of that standing its long-declared `semantic` source.
- **The model is `multilingual-e5-small`, not Supabase's built-in
  `gte-small`.** Measured on this catalogue: `gte-small` scored same-author
  pairs 0.895 against 0.893 for different authors - no signal on Russian text,
  which is two thirds of the catalogue. The multilingual model's gap is 0.0065
  in a 0.018 spread, and its neighbours read correctly. `set_bok_embedding`
  refuses any other model, so the column can never hold two incomparable kinds
  of vector. Embedding runs through `scripts/embed-catalogue.mjs` (local ONNX,
  7 boks a second); the `embed` Edge Function stays deployed but is refused by
  that check until a multilingual model exists in a runtime we can call -
  Cloudflare Workers AI `bge-m3` is the intended next step.
- **547 curated public-domain boks** (348 Russian, 199 English, 138 authors;
  447 on 2026-09-20, +100 canon on 2026-09-21)
  replaced the 907 seeded ones, which were deleted with everything attached to
  them. Loading is `scripts/build-catalogue-sql.mjs` from JSONL under
  `work/catalogue-2026-09-20/`, idempotent on `import_key`. Publication dates
  are synthetic, spread over 30 days **and interleaved by language**: dated in
  file order, the newest half of every slate came out entirely English.
- **One arm.** `for_you` takes 100% of traffic, in the code default and in the
  `recommendation_experiments` row; `completion_first` is parked at 0. At 30
  readers a split answers nothing and costs half of them a worse feed.

**Both platforms are paid now, and what that changed (2026-09-20).**
Cloudflare **Workers Paid**: the 10 ms CPU cap is gone, and with it error 1102 -
177 requests were cut in the 24 h before the upgrade, none after. Supabase
**Pro** ($25/month, already paid): the plan alone did **not** resize the
database, which stayed on `NANO` (0.5 GB) - the instance that was swapping
520 MB and stalling. Switched to `MICRO`: 1 GB memory at the same
$0.01344/hour, **+$0.00 a month**, covered by Pro's included compute credits
(the dashboard marks it "Free Upgrade"). Confirmed in the database:
`effective_cache_size` 384 MB -> 768 MB, `shared_buffers` 224 MB -> 256 MB.
Pro also brings daily backups, which Free never had.

Three changes went with it, all about not needing a bigger instance:

- **A slate is 30 boks, not 80** (`readerSlateSize` in `reader-behavior.ts`).
  The whole slate ships with full texts, so 80 meant ~600 KB and most of the
  Worker's CPU per reader, of which a session reads a handful. Safe now that
  the feed appends the next slate five boks from the end. Measured after the
  deploy: Worker CPU **p50 22.9 ms -> 8.3 ms, p99 139 ms -> 29 ms**, feed
  response 136 KB on the wire.
- **The breaker cools down for 2 minutes, not 15.** It was sized for a cap
  that cut every request; a stalling database recovers in seconds, and 15
  minutes of browser ranking cost more than the fault.
- **`limits.cpu_ms: 1000` in `wrangler.jsonc`.** Paid bills CPU, so a runaway
  loop should fail on one request instead of becoming an invoice.

Still to do by hand in the dashboards, and neither costs anything: raise the
auth rate limits (below), and check the Resend plan's **daily** email cap
before inviting 100 people at once - Resend Free allows 100 a day, and one
invite wave plus the "send again" taps will reach it.

**Readers have an address to write to (2026-09-20).** `support@tryboks.com`
is received by **Cloudflare Email Routing** on the `tryboks.com` zone and
forwarded to the owner's inbox; the address is published on `/privacy`,
`/terms`, in Settings -> About, on the "Check your email" screen and under the
sign-in form (`lib/boks/contact.ts` holds the string once). Before this the
apex had no MX record at all, so every reply to a sign-in email bounced.

What is in DNS now: `MX` -> `route1/2/3.mx.cloudflare.net`, `TXT` ->
`v=spf1 include:_spf.mx.cloudflare.net ~all`, and Cloudflare's forwarding DKIM
at `cf2024-1._domainkey`. **This does not touch sending.** Resend signs with
`resend._domainkey.tryboks.com` and uses a custom return path on
`send.tryboks.com`, which carries its own SPF, so the apex SPF record is not
consulted for magic-link mail. The catch-all rule exists but stays disabled -
enabling it would collect spam as soon as the domain is crawled.

Two things follow from this and are not done: production auth mail is still
sent **from `hello@tryboks.com`**, which has no routing rule, so a reader who
replies to a sign-in email gets a bounce - either route `hello@` as well or
move the sender to `support@` in the Supabase dashboard (never with
`supabase config push`, it wipes the SMTP password). And replying *as*
`support@tryboks.com` needs Gmail's "Send mail as" over `smtp.resend.com`,
which needs a fresh Resend API key - the owner does that, no key goes in this
repo.

**Pre-launch QA for the first 100 readers (2026-09-19, Worker `066aad86`).**
Every reader, author and admin flow was walked and two code reviews were
verified; the full list with causes is
`docs/handover/2026-09-19-pre-launch-qa.md`. What changed for a reader: a
one-time hint on the first visit; Escape closes every sheet; reader messages
(Link copied, errors) appear as a short flash instead of nowhere; guest reads
count after 8 s on screen, not on arrival; the feed appends the next slate
five boks before the end instead of stopping at 80; like and share no longer
reload the feed; selecting text no longer turns the page; comment writers and
admins can delete a comment. For an author: the draft survives sign-up and
reloads, Revise edits the refused bok in place (`p_bok_id`), the title can be
left empty. For accounts: an old or cross-browser email link shows a plain
message and never signs anyone out; "Sign out of this device" is local; a
reader can delete their own account (Settings, nickname to confirm); `/privacy`
exists and Terms link to it. For admins: Approve requires confirmed rights,
restore returns a bok to the status it had before it was hidden. Migration
`20260919260000`.

**Dark theme, English-only interface, Escape closes Settings (2026-09-19).**
Settings -> Appearance offers System (default), Light and Dark; guests get the
same control at the foot of their sign-in panel. The choice is stored per
device (`localStorage` key `boks-theme`) and applied by an inline script in
`<head>` before first paint, which also follows the system and other tabs
(`components/boks/theme.ts`, tested against the app's own rule). The palette is
`:root[data-theme="dark"]` in `app/globals.css`; every colour the stylesheet
used to hard-code (glass surfaces, shadows, primary tints, status badges) is
now a token with a dark value, so new CSS should use tokens, never literals.
The last Russian UI string ("Лицензии") is gone. The settings panel closes on
Escape whenever it shows a close button.

**A boks is a title and a text; the title is optional (2026-09-19).** The
opening hook is retired: gone from the author form, the reader, the author
sheet, moderation and the inspector; the one stored hook was cleared, and a
trigger on `reels` keeps `hook` empty on every write path (the column stays so
views and RPCs that select it keep working). An empty title becomes the text's
first line with words on it - `boks_title_from_text` in the database (same
trigger), mirrored by `lib/boks/bok-title.ts` so the form shows the title the
author will get; shared vectors in its test and `checks.sql`. The catalogue
import follows the same rule and ignores `hook`/`teaser`/`summary`. The form's
"Story" field is now "Text". `submit_bok_for_review` keeps its signature
(`p_hook` accepted and ignored) so an old open tab still submits. Migration
`20260919240000`.

**Admins can hide a boks from the reader feed.** A fourth rail button, red,
after Share, drawn only for an admin; a warning dialog that requires a reason;
the boks leaves the feed for everyone and lands in Content → Deleted with who,
when and why - nothing is erased. The protection is the database, not the
button: `archive_bok` checks `is_boks_admin` (role read from `user_profiles`,
suspended and deleted accounts refused), `authenticated` has only SELECT on
`reels`, and `anon` cannot execute the function at all. `checks.sql` proves
guest, anonymous session, reader, the boks's own author, a suspended admin and
a direct table UPDATE/DELETE are all refused; production was probed the same
way. See `docs/handover/2026-09-19-admin-inspector-and-feed-hide.md`.

**A signed-in reader has one account library with Read, Liked, and Comments
views.** The RPC selects up to 120 recent ids from each activity and returns
their bounded union, searchable by title or byline and backed by the reader's
private `views`, `likes`, and `comments` activity through
`get_my_reader_library`. Opening an item inserts
that single boks at the reader's current place; the next gesture resumes the
recommendation slate, so the library cannot become a second selectable feed.
Guests never see these views. Production QA covered the owner account on
desktop and a 430 x 932 mobile viewport. It also found and fixed an old
magic-link draft that could replay a retired nickname choice and prevent all
account data from loading.

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


### Who the Data API may reach

Supabase wrote on 2026-09-24 that from **30 October** a new table in `public`
no longer receives automatic `anon`/`authenticated` grants; it asked that each
table be granted in the migration that creates it. Auditing for that turned up
something worse than a build problem.

**`boks_public_identity` was writable by anyone holding the publishable key** -
which is every browser that loads the app. The view is `select user_id, handle
from user_profiles`, simple enough that Postgres makes it updatable, and `anon`
held INSERT, UPDATE and DELETE on it by inheritance. A view without
`security_invoker` runs as its owner, so row-level security on `user_profiles`
never saw those writes. Probed against production before the fix: `PATCH
/rest/v1/boks_public_identity?user_id=eq.<id>` answered **200**, `DELETE`
answered **204**. They changed nothing only because the id passed did not
exist; a real one would have renamed or erased that reader's @handle.
`bok_rights` and `bok_reports` carried the same full grant for `anon`, where
the policies allow an admin to read and nothing else. Nothing in the source
asked for any of this - it arrived with Supabase's default on new objects, and
the RLS policies underneath read as if it had not.

`supabase/migrations/20260925100000_boks_data_api_grants.sql` revokes
everything `anon` and `authenticated` hold in `public` and grants back exactly
what the app uses: three objects readable by guests (`published_boks`,
`boks_comments`, `boks_public_identity`), eleven readable by a signed-in
reader, four written directly by the client (`likes`, `comment_likes`, `views`,
`user_profiles`), and the sequences. Everything else - feedback, journey
events, team devices, the reels table itself - is reached only through
security-definer functions, which run as their owner and need the caller to
hold nothing. `service_role` is untouched; it never leaves the Edge Function.

After applying it, the same probes answer **401 `permission denied for view
boks_public_identity`**, `bok_rights` for `anon` answers 401, and the reads the
app depends on still answer 200. Verified as a guest on tryboks.com afterwards:
a bok opens, and the network log shows `200 likes`, `201 views`, `200
rpc/get_boks_user_context`, `200 rpc/get_my_followed_authors`, `204
rpc/record_boks_journey_event`, `200 rpc/record_recommendation_events`, with
zero failed requests.

No `alter default privileges` is set, deliberately: restoring an automatic
grant would recreate the thing that caused this. **A new table or view that the
Data API should reach now grants explicitly, in the migration that creates
it** - and `scripts/local-supabase/checks.sql` asserts the whole surface, plus
two invariants that make the original defect unrepeatable: no view in `public`
grants a write to `anon` or `authenticated`, and `anon` can write nowhere in
`public` at all. A missing grant fails `npm run verify:schema` rather than
appearing as a 401 in somebody's browser.
---

## Not in production

| Thing | Why |
|---|---|
| Delivery to somebody other than the account owner | Applied on 2026-09-17: production `site_url` is `https://tryboks.com`, the redirect allow-list carries both origins with their `/**` forms, and the sender is `hello@tryboks.com` on a Resend-verified domain (`tryboks.com`, eu-west-1). What is **not** proven is delivery: the Resend log shows every email ever sent went from the `onboarding@resend.dev` sandbox to the account owner's own address and nowhere else. Until a magic link arrives in somebody else's inbox, "email works" stays an assumption. |
| Replies to `hello@` and DMARC on `tryboks.com` | Cloudflare Email Routing forwards `support@tryboks.com`, but `hello@` - the auth sender - has no rule, so a reply to a sign-in email bounces. No `_dmarc` record - not required, but Gmail and Yahoo treat a sender without one more harshly. Neither blocks sending. |
| The current reader redesign | Source Serif 4, reversible edge/gesture navigation, deliberate progress-ring boundary pulls, axis-matched transitions, the simplified reaction rail, and the in-app font license are implemented and deployed. |

---

## The recommendation system

The substance lives in three documents, in this order:

1. **`docs/research/recsys-system-report.md`** — the whole system described for an outside
   reader: signals, strategies, instrumentation, statistics, what was wrong and
   how it was fixed, and the measured state. Start here.
2. **`docs/research/recsys-research-implementation-plan.md`** — the phased plan, sections
   A–N. Phase 1 is done; Phases 2–7 are not.
3. `docs/adr/0001-ranking-executes-in-worker.md` — why ranking moved to the
   Worker.

### What is true about it now

- `for_you` is the control arm and, since 2026-09-20, the only live arm
  (`docs/adr/0008-for-you-is-control-single-live-arm.md`). `completion_first`
  is parked at weight 0 as the challenger to reopen with.
- The challenger is **not** `recency`: on this corpus `for_you` and `recency`
  share 100% of their top ten for a cold reader and 80% for a reader with two
  weeks of history. `completion_first` shares 30–40%.
- Every comparison is **reader-level**. One reader is one sample however much
  they read. An interval spanning zero reports `inconclusive`, never "no
  difference"; below the minimum readers per arm nothing is estimated at all.
- **No experiment has produced a readable result yet**: with one live arm there
  is nothing to compare, by design.
- `for_you` has a semantic source: `multilingual-e5-small` embeddings
  (`docs/adr/0012-single-embedding-model.md`).
- A local database differs from production. Measurements quoted in the
  research documents were taken locally and are labelled as such; re-measure
  before citing one as a production figure.

### The honest limits

- At ~50 active readers a +30% difference in reading time is detected about 15%
  of the time. The console says so per comparison rather than printing a verdict.
- The design is between-reader, which is the weak design at this scale.
  Interleaving is in the schema but not in the serving path.
- Weights are hand-set. Nothing is trained.
- No candidate generation beyond a bounded, language-filtered candidate set
  (400 newest published boks).
- No explicit negative feedback (`not interested`, `hide author`). It existed in
  the original backend and is the cheapest remaining source of the variance
  this corpus lacks.

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

## How the reader is operated

Settled on 2026-09-19 after the controls and the pull to the next bok were
reported as not working. The rules live as tested pure functions in
`components/boks/reader-navigation.ts`; `reader-feed.tsx` only wires them.

- **The page follows the finger.** A swipe from right to left opens the next
  bok, left to right the previous one, and a trackpad agrees when two fingers
  move the same way. It was backwards on every phone until 2026-09-19: the
  product spec said "movement toward the left opens the previous bok", which
  folded a tap on the left edge together with a finger moving left, and one
  rule was shared by touch and trackpad although a wheel's delta has the
  opposite sign of a finger's. The trackpad came out right, the phone wrong.
  `horizontalWheelIntent` now converts the wheel into drag coordinates, the
  way the vertical pull always did.
- **The controls appear only when asked for.** A tap on the text toggles them;
  nothing else brings them up - not a new bok arriving, not a scroll, not a key.
  They used to flash in on every arrival, three separate times in the code, and
  on a phone a tap did nothing at all: the touch handler looked only for swipes
  and the pointer handler returns for touch.
- **An explicit open stays open** until the next tap, a scroll, or a change of
  bok. There is no fade timer - someone who opened the controls to like a piece
  should not watch them vanish while deciding.
- **On touch every tap toggles, even at the edges.** A phone is narrow, edge
  zones would cover half of it, and reaching for the controls must not jump to
  another bok. On touch, changing bok is a swipe or a pull. A mouse keeps its
  edge clicks.
- **Not a tap:** movement over 10px, a hold over 450ms (that is how a line gets
  selected), or a touch within 150ms of the text scrolling (that touch stops a
  flick; it is not a request).
- **The pull to the next bok has to be meant.** The first 18px count for
  nothing and the pull is 150px, where it used to be 104px from the first
  pixel - which a short poem, being at its end the moment it opens, tripped on
  an ordinary flick.
- **The pull is visible and has an armed state.** The cue shows from the moment
  the pull engages (its opacity used to equal progress, so it was a ghost for
  most of the gesture and was removed the instant it filled). Full, it turns
  solid, grows, says `release for next bok` and ticks once; letting go commits,
  pulling back disarms.
- **A trackpad commits on "release" too.** A wheel has no let-go, so the wheel
  going quiet for 450ms stands in for it - longer than the 300-400ms pauses
  trackpad momentum makes inside one swipe - and the armed cue is held at least
  320ms. It used to change bok mid-flick, the moment the travel filled.
- **Space and the down arrow scroll.** They used to change bok outright, so the
  first press threw someone paging through a long story out of it. Now they
  scroll a screen or a few lines, and change bok only from the end of the text.
  The side arrows change bok from anywhere.
- **Likes and replies show their count to the right of the icon, always** -
  zero included, muted. The like total is the public aggregate (how many, never
  who): the feed RPC already returned it to every client and the display row
  dropped it; a boks opened outside the slate (shared link, history) gets it
  from `get_bok_reactions` (migration `20260919140000`). The number on screen
  is `displayedLikeCount(total, likedOnServer, likedNow)`, so it moves the
  moment the heart does and does not double-count after the reload.
- **Acting on a boks never moves the reader off it.** Liking, replying and
  sharing reload the feed, and a like raises the boks's fatigue, which ranks it
  out of the 80-item slate - so the reader used to land on a stranger's piece
  after every like. The boks on screen is now found by id in each new feed, or
  carried into it at the reader's place (`holdPinnedStory`, the `hold` state in
  `reader-feed.tsx`, resolved during render so no wrong frame is committed).
  Only a reload that changes the reading languages lets it go. A boks carried
  out of the slate holds its total *without* this reader's like and keeps the
  like in local state, because `likedStoryIds` covers the slate only.
- **Arriving at a boks is keyed on its id alone.** The arrival effect - scroll
  to top, restart the reading clock, one impression, controls down - used to
  depend on the story object and on callbacks that change when the comment
  sheet opens, so a like, a reply or just closing the replies re-ran it: the
  text jumped to the top, the rail vanished, and a duplicate impression was
  logged. Expect impression counts per reader to drop from here on; earlier
  data is inflated by it.
- **Never glue a Tailwind utility to an interpolation.** Tailwind finds classes
  by scanning source text, so `` `pointer-events-auto${x}` `` generates nothing.
  That shipped once on 2026-09-19: the rail buttons inherited the rail's
  `pointer-events: none` and every tap on the heart fell through to the reader
  (near the right edge, that turns the page). Build class lists from whole
  literals; `ActionButton` joins an array.

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
   like as a state. With the D1 path removed nothing fills it with a real
   total either; the field and the `likedSet` argument to
   `mapSupabaseReelToStory` can go.
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
- ~~Deleting an account failed if any of its boks had no byline.~~ Resolved:
  both the admin delete (`20260919200000`) and a reader's own delete
  (`20260919260000`) archive the work first and give it the byline
  "Deleted author".
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
- **`docs/research/recsys-system-report.md` §16-17 is stale by an order of magnitude** - it
  reasons about 38 published pieces where there are now 906, so its arm
  divergence table and its justification of the live split are no longer valid.
- **Fixed 2026-09-19: a per-boks share link opened a different boks.** Two
  causes. `loadSupabaseStory` filtered `published_boks` on `status`, which the
  view does not expose (it is published-only by definition), so PostgREST
  answered 42703 for everyone - and it returned null for guests outright, who
  are most of the people a link is sent to. Then, when the boks happened to be
  in the first feed, `openReadBoks` jumped to an index taken from that feed
  just as the page's second feed request (the one adopting the account's
  reading languages) landed. It now always fetches by id and is open to guests,
  and the reader stays on the boks on screen through a reload (see "How the
  reader is operated"). The two degraded-feed fallbacks had the same `status`
  filter and were fixed with it.
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
  rather than a count. The D1 path that filled it with a real total is gone,
  so the field and the `likedSet` argument can go.

---

## Where to start, by task

| Task | Read |
|---|---|
| Get a local environment working | `docs/local-environment-runbook.md` |
| Deploy, or manage services | `docs/hosting.md`, `docs/local-agent-infrastructure.md` |
| Change the recommender | `docs/research/recsys-system-report.md`, then the plan |
| Add or change a metric | `docs/admin-metrics.md` |
| Change product scope | `specs/boks-product-spec.md` |
| Pick up in-flight work | GitHub Issues (`docs/agents/issue-tracker.md`), then the newest file in `docs/handover/` |
