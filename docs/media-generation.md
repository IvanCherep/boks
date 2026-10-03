# Generating voice, sound and music

Everything boks plays is generated through one account: narrations, the sounds a
story moment makes, a poem's theme, the lo-fi under the ordinary feed. This is
the infrastructure around that — the key, the plan, what each endpoint costs,
and the rules that are expensive to get wrong.

For *what* to generate and *where it goes*, read `docs/reading-formats.md`.
This file is about the account and the API.

---

## 1. The key

`ELEVENLABS_API_KEY` in `.env.local`, at the repository root. That file is
ignored by git (`.gitignore` line 32, `.env*`) and must never be committed,
pasted into a chat, or written into any file under `docs/`, `scripts/` or
`public/`.

Load it for a one-off command:

```bash
cd /Users/iegorov/Documents/Codex/2026-09-09/fd   # or wherever the repo is
set -a && . ./.env.local && set +a
```

### Scopes the key needs

Set per key in the ElevenLabs dashboard, not per plan. A missing scope returns
**401**, which is easy to misread as a bad key.

| Scope | Needed for |
|---|---|
| `text_to_speech` | every narration |
| `sound_generation` | the sounds a moment makes |
| `music` | a poem's theme, the reading track |
| `speech_to_text` | checking a theme has no words in it |
| `voices_read` | browsing the voice library to cast a piece |
| `user_read` | checking the credit balance |

### Checking the key and the balance

```bash
curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" \
  https://api.elevenlabs.io/v1/user/subscription | python3 -m json.tool
```

At the time of writing: tier `creator`, **9,412 of 126,863** credits used, 30
voice slots, professional cloning available.

### When a request fails

| Code | What it actually means |
|---|---|
| **401** | the key is missing a scope, not that the key is wrong — check the table above |
| **402** | the plan does not include this endpoint (the Music API is paid-only) |
| **403** | almost always rate limiting, not permission. Space requests a few seconds apart and retry; firing three large generations in a tight loop reliably trips it |
| **422** | a parameter the model does not accept for that voice or model id |

---

## 2. The plan, and what it costs

**Creator**, about 100,000 credits a month. On v4 one credit is one character, so
credits are characters.

| | credits |
|---|---|
| A 2–3 minute prose piece (~1,800 chars) | ~1,800 |
| A short poem (~200 chars) | ~200 |
| Music or a sound bed | **~820 per minute**, whatever the prompt says |
| Casting six voices on two passages | ~700 |
| The whole catalogue (2,126,582 chars) | ~2.1 M, around $480 at ×1 |

So a fully produced poem — reading plus its own theme — is around 2,200 credits,
and a prose piece with a theme would be about 4,000. Roughly thirty finished
pieces fit in a Creator month.

### The two things that cost real money

**Voice credit multipliers.** A library voice carries a `rate`. Most are 1.0;
some Russian ones are 2.0 or 3.0, which is invisible on one piece and worth
hundreds of dollars across the catalogue. All four cast voices in
`components/boks/cinema/voices.ts` are 1.0, and a test holds them there. Check
`rate` before swapping any of them.

**The licence follows the month, not the file.** Audio generated during a paid
month keeps its commercial licence permanently, even after the plan lapses.
Audio generated on a free plan has no commercial licence at all and requires
attribution, whatever you do with it afterwards. Anything generated before the
plan was bought has to be regenerated before a public launch — a month of
generating is a month of generating, not a subscription to maintain.

---

## 3. The endpoints actually used

### A narration, with timings

Always `/with-timestamps`. The response carries a time for every character, and
that alignment is what makes the highlight exact instead of estimated.

```bash
curl -X POST \
  "https://api.elevenlabs.io/v1/text-to-speech/<voice_id>/with-timestamps?output_format=mp3_44100_128" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
  -d '{"text":"…","model_id":"eleven_v4",
       "voice_settings":{"stability":0.5,"similarity_boost":0.8}}'
```

Returns `audio_base64` plus `alignment`. Decode the audio to
`public/<format>/<slug>/narration.mp3` and save the alignment beside it.

**Always assert that `alignment.characters.length` equals the text length**
before using it. If they differ, the recording and the text have diverged and
every timing after that point is wrong.

Two settings the model ignores, so do not reach for them: `speed`, and
`<break time="…"/>` tags. Both come back with the duration unchanged. If a
reading is too fast, that is a property of the take — record it again or slow it
at playback.

### A sound effect

```bash
curl -X POST "https://api.elevenlabs.io/v1/sound-generation" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
  -d '{"text":"…","duration_seconds":12,"prompt_influence":0.75,"loop":true}'
```

Up to 22 seconds. `loop: true` makes the ends meet, which matters for anything
that plays while a reader holds a gesture.

### Music

```bash
curl -X POST "https://api.elevenlabs.io/v1/music" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" \
  -d '{"prompt":"…","music_length_ms":127000,"force_instrumental":true}'
```

**Always `force_instrumental: true`, and never name the piece in the prompt.**
Without the flag the model may write a song, and given a poem's title it sings
the poem's own words - the first two English themes did exactly that, so a
reader heard a second voice singing the text under the narrator. Describe the
mood, the instruments and the place, not the work. Then **check the take for
words** before using it: run it through speech-to-text and require zero.

```bash
curl -s -X POST https://api.elevenlabs.io/v1/speech-to-text \
  -H "xi-api-key: $ELEVENLABS_API_KEY" -F model_id=scribe_v1 -F file=@theme.mp3
# an instrumental take comes back as a tag like "[outro jingle]" and no words
```

Paid plans only — it answers **402** on a free one. Generate to the exact length
of the piece rather than looping something shorter; a theme that never repeats
is worth the credits.

### The voice library

```bash
curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" \
  "https://api.elevenlabs.io/v1/shared-voices?page_size=100&page=0&language=ru&use_cases=narrative_story&category=professional"
```

Page with `page=`, and dedupe by `voice_id` — paging can repeat entries. The
fields worth filtering on are `rate` (the multiplier), `accent` (`standard` or
`moscow` for genuinely Russian voices; a voice listed under Russian with
`accent: american` is the trap that made an early take sound foreign),
`verified_languages`, and `cloned_by_count` as a rough proxy for how well a
voice has worked for other people.

### Models

```bash
curl -s -H "xi-api-key: $ELEVENLABS_API_KEY" https://api.elevenlabs.io/v1/models
```

`eleven_v4` for everything: 85 languages, 10,000 characters a request, follows
audio tags more reliably than v3 and holds its delivery across a long text.

---

## 4. Choosing by measurement, not by ear

Nobody on this project can listen to a generated take before shipping it, so
takes are compared by numbers. These are the measures that have actually
decided something:

| Question | Measure |
|---|---|
| Is this read with expression? | dynamic range, and what share of the take is silence — more of both is phrasing rather than recitation |
| Will this be audible on a phone? | energy **above 300 Hz**. A phone reproduces nothing below it; a heartbeat matched on full-band RMS was still silent on a handset, 25 dB down where it counted |
| Will this music bury the words? | energy in the **1–3 kHz** band, where consonants live. Lower is better, and a dip there beats turning the whole thing down |
| Is this bed steady enough to sit under speech? | the variance of its envelope. Anything that lurches pulls attention off the voice |

Decode to WAV with `afconvert -f WAVE -d LEI16@22050 -c 1 in.mp3 out.wav` and
measure in Python; no extra tooling is installed and none is needed.

Reference levels, all against the narration's own active level (the level while
it is actually speaking, not the mean across its pauses):

| | |
|---|---|
| An effect loop | match the voice |
| A poem's theme | **−10 dB** — part of the reading |
| Music under speech generally | −20 dB, the middle of broadcast's 15–25 dB |
| Lo-fi under silent reading | −3 dB, because continuous music reads louder than speech, which is half pauses |

---

## 5. Where this sits in the rest of the infrastructure

Nothing here touches Supabase, Cloudflare or the build. Generated media is
committed as ordinary files under `public/` and ships with the Worker.

| Job | Read |
|---|---|
| Deploying, environment variables, rollback, DNS | `docs/hosting.md` |
| Running locally, the mailbox, migrations across three databases | `docs/local-environment-runbook.md` |
| Services, the pre-deploy gates, the deploy checklist | `docs/local-agent-infrastructure.md` |
| Trust boundaries, RLS, release checks | `docs/security.md` |
| Manual test scripts and acceptance checks | `docs/testing.md` |
| What to generate and where it goes | `docs/reading-formats.md` |

### The two rules that break production

```bash
npx supabase db push --linked   # before npm run deploy, when a migration changed
```

**Never run `supabase config push`.** It clears the Resend password out of the
auth config and stops every sign-in email. This is written in five other
documents for the same reason.

### Before any deploy

```bash
npm run lint && npm run typecheck && npm test && npm run build
npm run deploy
git push github main
```

Generated audio and images are large binaries in git. Convert images to WebP
before committing (`cwebp -quiet -q 82 -m 6 -sharp_yuv in.png -o out.webp`,
roughly ten times smaller) and keep the source PNGs outside the repository.
