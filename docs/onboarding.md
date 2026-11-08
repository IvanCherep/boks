# Onboarding: full local setup for a new developer

From a fresh laptop to: the app running locally, every check passing, and the
same access to production as the owner (deploy, database, admin console).
About an hour, most of it waiting for access invites and Docker images.

No secret is written in this repository. Every value below says where to get it.

---

## 1. Access the owner grants (owner's checklist)

| Service | What to grant | Needed for |
|---|---|---|
| GitHub `IvanCherep/boks` | Collaborator, **Write** (Settings -> Collaborators) | push, issues (the backlog) |
| Server `boks-app` (Selectel) | Their **public** SSH key in `~boks/.ssh/authorized_keys` (below). Nothing else: the deploy scripts read what they need from the server | `npm run deploy`, `deploy/migrate.sh`, logs |
| Cloudflare (DNS of `tryboks.com`, Telegram relay Worker) | Member with **DNS** / **Workers admin** - only if they will touch those | DNS, `deploy/telegram-relay` |
| Supabase project `vcmrvnihbptostnzaean` | Not needed: since 2026-11-07 it is only a backup of the old production | - |
| Resend (`tryboks.com` domain) | Team member - only if they will touch sign-in email | SMTP, delivery logs |
| boks admin console | After they sign up on https://tryboks.com: `/admin` -> People -> grant **admin** | `/admin`, moderation, the experiment lab |
| `RESEND_API_KEY`, `ELEVENLABS_API_KEY` | Same, and only if needed (auth config push / audio generation) | see `docs/local-environment-runbook.md`, `docs/media-generation.md` |

### Production deploy access (server `boks-app`)

The engineer makes a key and sends only the public half (`.pub`):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/boks_ed25519 -C "<their name>"
```

The owner, or anyone who already has access, adds it, with their name in the comment:

```bash
ssh boks-app 'echo "ssh-ed25519 AAAA... <their name>" >> ~/.ssh/authorized_keys'
```

The engineer adds to `~/.ssh/config`:

```text
Host boks-app
  HostName 135.106.236.123
  User boks
  IdentityFile ~/.ssh/boks_ed25519
```

and checks: `ssh boks-app true`, `bash deploy/release.sh --list`, `bash deploy/migrate.sh` (a dry run).
That is all `npm run deploy` needs. The user `boks` has sudo, so this is full
access to the server, not only to releases. To take it away, delete their line
from `~/.ssh/authorized_keys` on the server.

## 2. Install the tools

- **Node.js 22.13+** (`node -v`) and npm
- **Docker Desktop**, running - local Supabase stack and `npm run verify:schema`
- **git** and **GitHub CLI** (`brew install gh`)
- Supabase CLI and Wrangler come from the project's dependencies (`npx ...`), no global install.

## 3. Clone and install

```bash
git clone https://github.com/IvanCherep/boks.git
cd boks
npm ci
```

## 4. Log in to the services

```bash
gh auth login -s workflow          # 'workflow' scope: needed to push .github/workflows changes
npx wrangler login                 # browser login to Cloudflare
npx wrangler whoami                # must list the boks account
npx supabase login                 # browser login to Supabase
npx supabase link --project-ref vcmrvnihbptostnzaean   # asks for the database password
npx supabase migration list --linked                   # local and remote columns should match
```

## 5. Create the env files

Two files, both git-ignored. Which file reaches which backend is the main trap
in this project - read `docs/local-environment-runbook.md` §1 once.

**`.env.local` - production Supabase** (used by `build`, `start`, `deploy`, `verify:supabase`):

```bash
cp .env.example .env.local
```

Fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from Supabase
dashboard -> Project Settings -> API (Project URL, publishable key). Both are
public values compiled into the browser bundle, not secrets. Never put the
service-role key anywhere.

**`.env.development.local` - local stack** (used by `npm run dev` only):

```bash
npx supabase start     # first run pulls images; prints the local API URL and keys
```

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<"Publishable key" / anon key from `npx supabase status`>
```

These are the Supabase CLI's fixed local keys, not secrets.

**Never create `.env.production.local`** - it once shipped a bundle pointing at
a laptop to production.

## 6. Check that everything works

```bash
npm run check            # lint + typecheck + unit tests, offline
npm run verify:schema    # every migration + RLS checks in a throwaway Postgres (Docker)
npm run verify:supabase  # RLS probes against production (as a guest; writes one test view and like)
npm run dev              # http://localhost:5173 against the local stack
```

Local sign-in needs a local admin and the local mailbox: follow
`docs/local-environment-runbook.md` §2-§4 (sign-in email does not arrive
locally until the Resend SMTP block is switched off there).

If all four pass and `wrangler whoami` shows the account, the setup is done.

## 7. Daily work

- Read `AGENTS.md` - rules, where each kind of change starts, validation. AI agents
  (Claude Code, Codex) load it automatically through `CLAUDE.md` / `AGENTS.md`.
- Words: `CONTEXT.md`. Current state: `docs/project-state.md`. Backlog: GitHub Issues.
- Before pushing: `npm run check`. CI re-runs it with the build and schema check.
- Schema change: a **new** file in `supabase/migrations/`, never edit an applied one.

**Releasing to production**, always in this order (`docs/hosting.md`):

```bash
npm run check && npm run verify:schema
bash deploy/migrate.sh                      # dry run: anything pending? read the SQL
bash deploy/migrate.sh --apply              # schema first...
npm run deploy                              # ...then the app, no downtime (docs/hosting.md)
curl -s -o /dev/null -w '%{http_code}\n' https://tryboks.com/   # 200
```

Then record what shipped in `docs/project-state.md`.

Never roll the Worker back on its own, never print or commit a secret, and run
`npx supabase config diff` before any `config push`.
