/**
 * Reading facets: what a reader can ask the feed for ("Что почитать").
 *
 * The registry here and the rows in `reading_facets` / `reading_facet_values`
 * (20261118120000) describe the same thing: the database refuses a label whose
 * facet or value it does not know, and this file holds the words a labeller
 * (a model or an editor) decides by. Change a rubric's meaning -> raise its
 * `rubricVersion` here and in `reading_facets`, and every label written under
 * the old version becomes due for a new look. Adding a facet is a new forward
 * migration that registers it plus an entry here. `docs/reading-facets.md` has
 * the whole design.
 */

export type FacetSubject = "bok" | "byline" | "derived";

export type FacetDefinition = {
  key: string;
  /** What carries the label: one bok, one byline, or nothing (computed from existing columns). */
  subject: FacetSubject;
  /** More than one value per subject. */
  multiple: boolean;
  rubricVersion: number;
  values: readonly string[];
  /** The rubric a labeller follows, in Russian: the catalogue is read and edited in Russian. Empty for derived facets. */
  rubric: string;
};

export const moodRubric = `Настроение bok: что получит читатель, который нажал кнопку настроения.

Для каждого значения задай один вопрос: «Человек нажал эту кнопку. Лента открыла ему этот bok. Он доволен, что получил именно то, о чём просил?» Ставь значение только при уверенном «да». Сомнение = не ставить.

sad — «Погрустить». Главное чувство текста: печаль, утрата, тоска, одиночество, сожаление, разлука, светлая грусть, элегия. После текста остаётся грустное или щемящее настроение. НЕ ставить только за тишину, медленный темп, пейзаж, осень, старинный слог. Страх, ужас, тревога, напряжение — это не грусть. Трагический финал считается, если вызывает сочувствие и печаль, а не только испуг.

fun — «Повеселиться». Текст заставит улыбнуться или рассмеяться: юмор, комическая ситуация, ирония, сатира, пародия, абсурд, остроумие, озорство, словесная игра. Сатира с горьким послевкусием — да, если смешное — основной способ текста. НЕ ставить за просто светлый, тёплый или счастливый текст без комического. НЕ ставить, если смешное — эпизод внутри серьёзного текста.

think — «Подумать». Текст ставит вопрос и оставляет читателя с ним: о смысле жизни, смерти, времени, вере, совести, свободе, обществе, природе человека. Притча, философская лирика, моральная дилемма, неоднозначный финал, который хочется обдумать. НЕ ставить автоматически любой серьёзной классике: размышление должно быть тем, ради чего этот текст стоит открыть.

Порядок: сначала самое сильное значение. Обычно одно, иногда два, три — почти никогда. Пустой список — честный ответ, если ни одно не подходит уверенно (например, приключение, страшный рассказ, описание без явного настроения).`;

export const authorGroupRubric = `Группа автора по byline (имени на bok), не по аккаунту, который опубликовал текст.

classics — «Классики». Писатель или поэт прошлого, чьё творчество завершено и вошло в литературный канон: XIX век, Серебряный век, первая половина XX века и раньше. Признак — он давно умер и его читают как классику, а не дата загрузки bok.

contemporary — «Современные». Ныне живущий автор или автор, пишущий сейчас. Автор, публикующий собственные тексты со своего аккаунта в boks, почти всегда современный.

Пустой список — если по имени нельзя уверенно сказать, кто это (псевдоним без сведений, народное, «Неизвестный автор»). Неизвестное не объявлять современным.`;

export const facets = [
  {
    key: "mood",
    subject: "bok",
    multiple: true,
    rubricVersion: 1,
    values: ["sad", "fun", "think"],
    rubric: moodRubric,
  },
  {
    key: "author_group",
    subject: "byline",
    multiple: false,
    rubricVersion: 1,
    values: ["classics", "contemporary"],
    rubric: authorGroupRubric,
  },
  {
    // `reels.reading_shape`: verse -> poetry, short_prose / long_prose -> prose,
    // unknown -> no format at all (never counted as prose).
    key: "format",
    subject: "derived",
    multiple: false,
    rubricVersion: 1,
    values: ["prose", "poetry"],
    rubric: "",
  },
] as const satisfies readonly FacetDefinition[];

export type FacetKey = (typeof facets)[number]["key"];

export function facetDefinition(key: string): FacetDefinition | undefined {
  return facets.find((facet) => facet.key === key);
}

/**
 * Keeps only what the rubric allows: known values, each once, in the given
 * order, at most one for a single-valued facet. A labeller's answer goes
 * through this before it is written; the database checks the same rules.
 */
export function cleanFacetValues(key: string, raw: unknown): string[] {
  const facet = facetDefinition(key);
  if (!facet || !Array.isArray(raw)) return [];
  const allowed = new Set<string>(facet.values);
  const seen: string[] = [];
  for (const value of raw) {
    if (typeof value === "string" && allowed.has(value) && !seen.includes(value)) seen.push(value);
  }
  return facet.multiple ? seen : seen.slice(0, 1);
}
