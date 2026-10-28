# 0016: The whole app follows the interface language

Date: 2026-10-28
Status: accepted. Supersedes the last paragraph but one of 0015 ("The admin console and the legal pages stay English").

0015 made the reader bilingual and left two surfaces English: the admin console, as the founder's own tool, and the legal pages, because a translation of a legal text must not be a paraphrase. The founder has decided otherwise: when the interface language is Russian, everything is Russian, the console and the legal pages included.

- **Admin console (Studio).** Every tab's words live in `defineMessages` tables beside the component, like the reader's. Studio has its own EN / RU switch, which writes the same stored preference as the reader's account panel: there is one interface language per device, not one per surface. What stays as it is: data (titles, names, user text, study materials), machine-facing output (CSV and JSON exports, database values, event names, RPC names), hypothesis codes (РГ1, Б3), and the prompts the fragment cutter sends to a language model, which are not interface text.
- **Legal pages.** `/privacy` and `/terms` carry a full Russian translation of the English text, section by section, same facts and same effective date, picked on the client by the interface language. The two must change together: an edit to one without the other is a bug.
- **Server-rendered metadata** (page titles in link previews) stays English, for the reason 0015 gives: the server does not know the device.

The rule in AGENTS.md for reader strings now applies to every surface: a new visible string goes into a `defineMessages` table with all interface languages.
