# 0015: The interface language follows the device

Date: 2026-10-14
Status: accepted

The interface was English everywhere. It now has two languages: Russian when the device's *first* language is Russian (`navigator.languages[0]`), English for every other device, and the reader can pin either in the account panel (`boks-ui-language` in localStorage, like the theme). Only the first language counts because it is the one the person set; a Russian speaker who keeps a phone in English has said what they want to see.

It is a client-side decision. The server renders English and the first client render switches (`useSyncExternalStore` with an English server snapshot), and a boot script sets `<html lang>` before paint. The reader's first screen is a loading state, so nothing readable flips. A cookie read on the server would remove even that, at the cost of making every page dynamic; not worth it yet.

Words live in `defineMessages` tables next to the component that shows them, English as the shape and every other language checked against it by the typechecker. Adding a language is a code in `lib/i18n/ui-language.ts` plus a column in every table. The admin console and the legal pages stay English: one is the founder's tool, the other must not be paraphrased without review.

The interface language is not the reading languages (the feed's content filter) and does not change them. The series shelf no longer applies reading languages at all: it shows every language with its own filter, offering exactly the languages its pieces carry, so Italian or Serbian pieces need no interface change.
