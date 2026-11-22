# The Workshop on the server: the contract

Status 2026-11-22: the server side is built on branch `workshop`
(`20261122220000_boks_workshop.sql`, client `lib/boks/author-desk/server.ts`). The Workshop
(`/author/desk`, `docs/author-desk.md`) stops keeping texts in the browser and
works on the same rows as the cabinet. This page is the contract between the
database and the Workshop's client (`lib/boks/author-desk/server.ts`).

## Who

A verified author (`boks_publishes_directly`, any verified author page they own,
draft included). Everyone else gets "no workshop": errcode `42501`, message
"The Workshop is open to authors the editors invited.", hint `workshop_closed`
(`isWorkshopClosed` in `lib/boks/author-desk/server-rules.ts`), and the client
shows the way to My page. Studio uses Studio.

## New data

One table for what only the Workshop needs, keyed by the bok:

```
bok_workshop (
  bok_id      uuid primary key references reels(id) on delete cascade,
  author_id   uuid not null,
  form        text not null default 'poem' check (form in ('poem','prose')),
  shelved_at  timestamptz,            -- «Отложено»
  queue_pos   integer,                -- the author's order among sent pieces
  notes       jsonb not null default '{}'::jsonb,
                -- { about: text, plan: [{id,text,done}], thoughts: [{text,at}],
                --   materials: [{id,kind,text,source?,pinTo?}] }, ≤ 64 KB
  updated_at  timestamptz not null default now()
)
```
RLS on, no table grants; only through the RPCs below. Notes are shape-light:
an object of at most 20 keys, 64 KB as Postgres prints it (`notes::text`, a
little larger than `JSON.stringify`); a value is a string of at most 2000
characters, a number, a boolean, null, or a list of at most 200 such values or
flat objects of them (`boks_workshop_notes_problem`, mirrored by
`notesProblem`). Studio never reads
`notes` (the author's own); Studio may read `queue_pos` to see the author's
order.

## Reads

`get_my_workshop()` → one JSON object, everything the Workshop shows:

```
{
  "author": { "userId", "handle", "name", "pageId", "pageStatus" },
  "plan":   { "perYear": 50, "perWeek": 1, "usedThisYear": <series accepted or later this calendar year> },
  "pieces": [
    {
      "id", "title", "text", "status",          -- reels.status
      "coverRequested", "coverVersion",
      "createdAt", "updatedAt",
      "form", "shelvedAt", "queuePos", "notes", -- bok_workshop (defaults when absent)
      "voice": null | { "file", "durationMs", "source": "teleprompter"|"upload", "name", "at", "current" },
                -- current: the take reads the text as it is (boks_voice_fingerprint = voiceFingerprint)
      "decision": null | { "decision": "changes"|"refused", "kind", "note", "at" },
      "series": null | { "state": "accepted"|"sent"|"published", "acceptedAt", "sentAt",
                         "publishedAt", "workId", "revision", "workStatus",
                         "seriesPiece" },   -- link-only token to watch, null before it is sent
      "importedFrom": null                      -- reserved for imports
    }
  ],
  "ready": [ team-prepared works on the author's page with status 'ready' that are
             NOT a piece's Series (no `bok_series_work` points at them):
             { "workId", "revision", "title", "format", "bokId" } ]
}
```
Pieces: every `reels` row the author owns that is not deleted (`archived`
counts as deleted), newest first, bounded (200). `text` is included (the
Workshop edits it). `decision` is shown while it still applies (changes on a
draft, a refusal on a rejected piece), as `get_my_editor_decisions` does.
`series` is null for a piece never accepted or returned from work.
`plan.usedThisYear` counts this calendar year's acceptances (`accepted`,
`sent`, `published`).

## Writes (all check the caller owns the bok and is a verified author)

| Action in the Workshop | Call |
|---|---|
| «Добавить текст» / edit text and title | existing `save_my_bok(id, title, text, publish=false, cover=null, by_team=false)` |
| Stihi / Proza switch, notes, «Отложить» / «Вернуть в работу» | `save_my_workshop_meta(p_bok_id, p_patch jsonb)` with any of `form`, `shelved` (bool), `notes` |
| Recording, upload, choose, delete | existing `/api/author/voice/[bok]` routes |
| «Отдать в работу» | existing `save_my_bok(..., publish=true, by_team=true)`, then `set_my_queue_order` puts it last |
| ↑ ↓ / drag in the queue | `set_my_queue_order(p_ids uuid[])`: the author's sent pieces, in order; pieces in work are skipped |
| «Отозвать» | existing `withdraw_my_sent_bok` |
| «Опубликовать» a ready Series | existing `publish_my_author_space([{workId, revision}], publishPage, terms, requestId)` |
| «Попросить исправить» a ready Series | existing `request_author_space_changes(workId, note)` |
| «Написать редакции» | existing `send_author_space_message(body, workId?)` |
| Delete a draft | existing `delete_my_draft` |

Rules of the writes:
- `save_my_workshop_meta` answers `{ bokId, form, shelvedAt, queuePos, notes,
  updatedAt }`. A patch has any of `form` (`poem`/`prose`), `shelved` (bool)
  and `notes` (replaces them whole). Shelving is refused for a piece with the
  editors («Отозвать» first), one they have in work, and a published one.
- `set_my_queue_order` answers `[{ bokId, queuePos }]`, the queue as it now
  stands. The given ids come first, in order; pieces in work are skipped; any
  other waiting piece follows in its old order. A draft, another author's
  piece or a repeated id refuses the whole call. Two tabs are serialised on
  the author: the last order wins and the places stay 1..n.
- The queue keeps itself: a piece sent to the editors takes the last place
  (trigger on `reels`), and loses it when it leaves `pending_review`
  (withdrawn, returned, refused, published) or is accepted into work
  (trigger on `bok_series_work`).

Every refusal has a Russian translation in `lib/boks/errors.ts`; the client
throws one `WorkshopError` with the Russian message, the errcode and `closed`.

## Studio

Moderation shows the author's order beside each voiced piece («по очереди
автора: 2») and sorts the waiting voiced pieces by it, author by author
(`queuePos` on the review queue's items). `studio_series_work_list` carries
`queuePos` too, but a piece loses its place when it is accepted, so there it
is null; the list itself is in order of acceptance.
