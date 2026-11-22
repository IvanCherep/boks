# The Workshop on the server: the contract

Status 2026-11-22: being built on branch `workshop`. The Workshop
(`/author/desk`, `docs/author-desk.md`) stops keeping texts in the browser and
works on the same rows as the cabinet. This page is the contract between the
database and the Workshop's client (`lib/boks/author-desk/server.ts`).

## Who

A verified author (`boks_publishes_directly`, any verified author page they own,
draft included). Everyone else gets "no workshop" and the client shows the way
to My page. Studio uses Studio.

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
RLS on, no table grants; only through the RPCs below. Studio never reads
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
      "voice": null | { "file", "durationMs", "source", "name", "at", "current" },
      "decision": null | { "decision": "changes"|"refused", "kind", "note", "at" },
      "series": null | { "state": "accepted"|"sent"|"published", "acceptedAt", "sentAt",
                         "publishedAt", "workId", "revision", "workStatus" },
      "importedFrom": null                      -- reserved for imports
    }
  ],
  "ready": [ team-prepared works on the author's page with status 'ready' that are
             NOT tied to a piece above: { "workId", "revision", "title", "format", "bokId" } ]
}
```
Pieces: every `reels` row the author owns that is not deleted, newest first,
bounded (200). `text` is included (the Workshop edits it); a text past the
bok limit is still returned.

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

## Studio

Moderation and «Boks Series в работе» show the author's order (`queue_pos`)
so the editors take pieces in the order the author set.
