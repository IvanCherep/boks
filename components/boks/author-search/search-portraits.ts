/**
 * Which search rows get a portrait, and which one.
 *
 * Living authors: the photo they set on their page (`/a/<handle>/photo?v=`),
 * which the server names by its version. Classics: the portraits of the
 * onboarding archive (v52, 42 exact 512x512 files, already served from
 * `public/onboarding/assets/authors/classics-v52/`), matched by hand to the
 * real byline under the real publisher, @boks, as it stands on production
 * (checked 2026-11-25). A name matching is not an identity: a byline not
 * listed here, or the same name under another account, gets a monogram, never
 * someone else's face.
 */
export const CLASSICS_PUBLISHER = "boks";
const CLASSICS_DIR = "/onboarding/assets/authors/classics-v52/";

/** Byline under @boks -> portrait file. */
export const classicPortraitFiles: ReadonlyMap<string, string> = new Map([
  ["Александр Пушкин", "pushkin.webp"],
  ["Михаил Лермонтов", "lermontov.webp"],
  ["Лев Толстой", "tolstoy.webp"],
  ["Антон Чехов", "chekhov.webp"],
  ["Фёдор Достоевский", "dostoevsky.webp"],
  ["Сергей Есенин", "yesenin.webp"],
  ["Максим Горький", "gorky.webp"],
  ["Марина Цветаева", "tsvetaeva.webp"],
  ["Владимир Маяковский", "mayakovsky.webp"],
  ["Николай Некрасов", "nekrasov.webp"],
  ["Александр Блок", "blok.webp"],
  ["Александр Грин", "grin.webp"],
  ["Александр Куприн", "kuprin.webp"],
  ["Афанасий Фет", "fet.webp"],
  ["Фёдор Тютчев", "tyutchev.webp"],
  ["Николай Гумилёв", "gumilyov.webp"],
  ["Леонид Андреев", "andreyev.webp"],
  ["Иван Тургенев", "turgenev.webp"],
  ["Михаил Салтыков-Щедрин", "saltykov-shchedrin.webp"],
  ["Всеволод Гаршин", "garshin.webp"],
  ["Иван Крылов", "krylov.webp"],
  ["Константин Бальмонт", "balmont.webp"],
  ["Осип Мандельштам", "mandelstam.webp"],
  ["Валерий Брюсов", "bryusov.webp"],
  ["Аркадий Аверченко", "averchenko.webp"],
  ["Дмитрий Мамин-Сибиряк", "mamin-sibiryak.webp"],
  ["Владимир Одоевский", "odoyevsky.webp"],
  ["Иннокентий Анненский", "annensky.webp"],
  ["Андрей Белый", "bely.webp"],
  ["Алексей Апухтин", "apukhtin.webp"],
  ["William Shakespeare", "shakespeare.webp"],
  ["Edgar Allan Poe", "poe.webp"],
  ["Mark Twain", "twain.webp"],
  ["Oscar Wilde", "wilde.webp"],
  ["Emily Dickinson", "dickinson.webp"],
  ["Lord Byron", "byron.webp"],
  ["O. Henry", "ohenry.webp"],
  ["W. B. Yeats", "yeats.webp"],
  ["Saki", "saki.webp"],
  ["Walt Whitman", "whitman.webp"],
  ["Katherine Mansfield", "mansfield.webp"],
  ["Thomas Hardy", "hardy.webp"],
]);

/** The portrait of one search row, or null for a monogram. */
export function searchPortraitFor(row: { kind: "account" | "byline"; handle: string; byline: string | null; photoVersion: number | null }): string | null {
  if (row.kind === "account") return row.photoVersion ? `/a/${encodeURIComponent(row.handle)}/photo?v=${row.photoVersion}` : null;
  if (row.handle !== CLASSICS_PUBLISHER || !row.byline) return null;
  const file = classicPortraitFiles.get(row.byline);
  return file ? CLASSICS_DIR + file : null;
}
