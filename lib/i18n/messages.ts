import type { UiLanguage } from "@/lib/i18n/ui-language";

/**
 * One table of interface words, every language side by side.
 *
 * English is the shape; every other language must give the same keys with the
 * same types, so a missing translation is a type error rather than a blank
 * button. A message that depends on a number or a name is a function, and
 * each language writes its own - Russian plurals and word order do not fit an
 * English template.
 */
export type Messages<T> = Record<UiLanguage, T>;

export function defineMessages<T>(en: T, others: Record<Exclude<UiLanguage, "en">, NoInfer<T>>): Messages<T> {
  return { en, ...others } as Messages<T>;
}

type PluralForms = { one: string; few?: string; many?: string; other: string };

const rules = new Map<string, Intl.PluralRules>();

/**
 * The right word for a count in a language: `plural("ru", 3, {one: "сцена",
 * few: "сцены", many: "сцен", other: "сцены"})`. English uses one/other,
 * Russian one/few/many.
 */
export function plural(language: UiLanguage, count: number, forms: PluralForms) {
  let rule = rules.get(language);
  if (!rule) {
    rule = new Intl.PluralRules(language);
    rules.set(language, rule);
  }
  const category = rule.select(count) as keyof PluralForms;
  return forms[category] ?? forms.other;
}
