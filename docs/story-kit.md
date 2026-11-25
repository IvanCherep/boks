# For social media: pictures an author posts about their work

Status: prototype, local only (branch `author-share-kit`, 2026-11-23).

Authors want to post about their page and each work in Instagram, VK and
Telegram stories and posts. Until now they made screenshots. My page now has
a section **For social media** (Для соцсетей): a tile for the whole page and
one for every work readers can open, and a **For social media** button on
each published work's card. Each opens a sheet that draws ready pictures in
the boks look.

## What it draws

Two formats: **story** 1080x1920 (9:16) and **post** 1080x1350 (4:5). JPEG, quality 0.92.

| Style | For | What is on it |
|---|---|---|
| Poster (Афиша) | every work | the cover between the open velvet curtain, the pelmet, the yellow ribbon with boks and the red knob tying it; title, byline, "boks series" above a Series' title |
| Frame (Кадр) | a Series with a manifest | one picture of the Series, chosen from a strip, with the lines it carries on screen |
| Lines (Строки) | every work with text | lines the author picks (up to 8 lines, 420 characters) on paper under a strip of velvet, with the cover |
| Page (Страница) | the page | the author's photo on the closed curtain, name, "N texts · M Series", up to three covers fanned out |

Every card ends with an invitation ("Read on boks", "Watch and listen on boks",
"My writing on boks") and the page address `tryboks.com/@handle`. The bottom
290 px of a story are left for the reply bar and a link sticker; text stays
out of the top 250 px except the pelmet and ribbon.

The card's own words follow the work's language (Cyrillic title or name:
Russian), not the phone's: a Russian author on an English phone still posts
Russian cards.

## Rules

- Only the author's own words: title, byline, lines of the text. A Series
  quotes only what its recording reads (the manifest's lines), never a printed
  epigraph or dedication.
- Only published, visible works, and only when the page itself is open.
- Nothing is stored and nothing goes to the server: the browser draws the
  card from what My page already loaded (covers and Series frames of this
  origin, fonts and stage pieces from `public/share/`).

## Sharing to a story

On a phone (`pointer: coarse` and `navigator.canShare` with files) the sheet
has **Share to a story**. One tap copies the work's link, for the story's link
sticker, and opens the phone's share sheet with the picture
(`components/boks/story-kit/kit-share.ts`). The copy starts first and is not
awaited: a share sheet has to open while the tap still counts. The author picks
Instagram, VK or Telegram there; the sheet lists how to post in each, and that
"Save image" in the same menu puts the picture into the gallery. On a computer
there is only **Save the picture**.

The sticker gets the direct `tryboks.com` address (`russianShareUrl`): a
sticker shows no preview, and the direct address opens at once for a reader in
Russia. The two copy buttons of `ShareLinkPair` stay below for posts.

A website cannot open a network's story editor itself, so there is no button
per network:
- Instagram's Sharing to Stories is for native apps with a Facebook App ID.
- VK's `VKWebAppShowStoryBox` works only in VK Mini Apps; a site would need
  the Stories API with the user's token, on a server.
- Telegram's `shareToStory` works only in a Telegram Mini App, with the picture
  at a public URL.

Tested 2026-11-23 in phone mode in Chrome and WebKit (Safari's engine), with
the share sheet and clipboard replaced by recorders: a 1080x1920 JPEG reaches
the sheet, the link the clipboard, a closed sheet shows no error, Save
downloads. What the real menus offer (Instagram's Story choice, VK's,
Telegram's) is checked on a phone after release.

## Why in the browser

The link cards (`lib/boks/curtain.tsx`) are drawn on the server by `next/og`,
which cannot read WebP, the format of every Series frame. Drawing in the
browser also hands the file straight to the phone's share sheet. Nothing per
author: a new page or work gets its pictures the moment it is published.

## In Studio

Studio -> Authors -> an open author page has a card **For social media** with
the page and every published work: the same sheet, from the page's preview
(`get_author_space_preview`, `kit-subjects.ts`), so the team sees what an
author gets and can save pictures to post for them. Nothing new in the
database; the sheet wraps itself in `.acab` to keep the cabinet's look there.

## Files

- `components/boks/story-kit/kit-render.ts` - the drawing, canvas only.
- `components/boks/story-kit/kit-content.ts` - which lines a card may quote; tested.
- `components/boks/story-kit/kit-share.ts` - copy the link and open the share sheet in one tap; tested.
- `components/boks/story-kit/story-kit-sheet.tsx` - the sheet.
- `components/boks/story-kit/kit-subjects.ts` - a page's subjects from its preview, for Studio.
- `components/boks/admin/author-spaces.tsx` - the Studio card (`KitPanel`).
- `app/story-kit.css` - its styles and the tiles on My page.
- `components/boks/author-cabinet/my-page.tsx` - the section and the card button.

## Not yet

- A moving story: the curtain opening on the cover as a vertical MP4, made by
  the curtain job on the server (`deploy/curtain/`), the way the link loops are.
- The same sheet on the reader's Share sheet.

## The same picture for readers (2026-11-25, local)

The reader's **Share bok** sheet (`components/boks/share-card.tsx`) draws its
picture with the same engine (`story-kit/kit-editor.tsx`: `useKitCard`,
`KitPreview`, `KitOptions`), from what the feed holds (`kitWorkFromStory`).
The sheet opens on the Poster story card; one quiet button, **Change the
picture**, unfolds the same choices (story/post, Poster/Frame/Lines, a frame,
lines) with the picture kept in sight above them. The link buttons stay as
they were; the picture button shares to a story on a phone (copying the link
for the sticker) and saves elsewhere. The card prints the author's page,
`tryboks.com/@handle`, or the site's address for a bok without one.
