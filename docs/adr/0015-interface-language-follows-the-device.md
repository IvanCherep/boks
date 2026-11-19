# 0015: The interface language follows the device

Date: 2026-10-14
Status: accepted

The interface was English everywhere. It now has two languages: Russian when the device's *first* language is Russian (`navigator.languages[0]`), English for every other device, and the reader can pin either in the account panel (`boks-ui-language` in localStorage, like the theme). Only the first language counts because it is the one the person set; a Russian speaker who keeps a phone in English has said what they want to see.

It is a client-side decision. The server renders English and the first client render switches (`useSyncExternalStore` with an English server snapshot), and a boot script sets `<html lang>` before paint. The reader's first screen is a loading state, so nothing readable flips. A cookie read on the server would remove even that, at the cost of making every page dynamic; not worth it yet.

Words live in `defineMessages` tables next to the component that shows them, English as the shape and every other language checked against it by the typechecker. Adding a language is a code in `lib/i18n/ui-language.ts` plus a column in every table. The admin console and the legal pages stay English: one is the founder's tool, the other must not be paraphrased without review.

The interface language is not the reading languages (the feed's content filter) and does not change them. The series shelf no longer applies reading languages at all: it shows every language with its own filter, offering exactly the languages its pieces carry, so Italian or Serbian pieces need no interface change.

## Amended 2026-11-20: the server renders the request's language

The flip was seen after all. A phone reloads a tab it has put to sleep, and on a slow first load the English
loading screen showed long enough to read. Every page was already rendered per request (no shared cache), so
reading the request costs nothing new. The root layout now takes the language from the request
(`uiLanguageFromRequest`):
- the reader's choice, mirrored into a `boks-ui-language` cookie whenever it is saved, and by the boot
  script for a choice made before the cookie existed;
- otherwise the first language of `Accept-Language`, which is the same list as `navigator.languages`.

`UiLanguageProvider` hands that value to `useUiLanguage` as the hydration snapshot, so the server, hydration
and the client agree. A reader whose choice predates the cookie sees one flip, once.
