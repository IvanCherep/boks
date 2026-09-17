import { describe, expect, it } from "vitest";
import {
  rankVariants,
  readRedactionHub,
  rejectPiece,
  wikitextToPiece,
} from "@/lib/boks/import/wikitext";

const limits = { minCharacters: 200, maxCharacters: 20_000 };

/**
 * Every case below is a page shape that really occurs on Russian Wikisource,
 * and most of them are bugs this converter had on its first run over the live
 * catalogue. The fixtures are trimmed from the real pages.
 */

describe("wikitextToPiece", () => {
  it("takes the poem out of a verse template and leaves the infobox behind", () => {
    const piece = wikitextToPiece(
      `{{Отексте
| АВТОР = [[Александр Сергеевич Пушкин]] (1799—1837)
| НАЗВАНИЕ=Я вас любил
| ДАТАПУБЛИКАЦИИ=1830<ref>Впервые&nbsp;— в&nbsp;альманахе {{Северные цветы|год=1830}}</ref>
| ИСТОЧНИК=[http://feb-web.ru/ ФЭБ (1948)]
}}
{{аудиостатья|push.ogg}}
{{v||
Я вас любил: любовь ещё, быть может,
В душе моей угасла не совсем;
|1829}}

[[File:publication.png|center|thumb|400px|<center>Журнал, 1830</center>]]
[[Категория:Русская поэзия]]`
    );

    expect(piece).toEqual({
      shape: "verse",
      text: "Я вас любил: любовь ещё, быть может,\nВ душе моей угасла не совсем;",
    });
  });

  it("keeps the poet's line breaks from a <poem> block and drops its furniture", () => {
    const piece = wikitextToPiece(
      `{{Отексте|АВТОР=[[Иван Андреевич Крылов]]|НАЗВАНИЕ=Волк и Ягнёнок}}
<poem>
{{poem-section|[[Басни (Крылов)#Книга первая|Басни. Книга первая]]}}
{{poem-title|XIII. <br>Волк и Ягнёнок}}
У сильного всегда бессильный виноват:
:: Но мы Истории не пишем;
{{---|4em|0}}
Ягненок в жаркий день зашел к ручью напиться;
:::: И надобно ж беде случиться,
''<1808> ''
</poem>

== Декламация ==
* [http://www.stihophone.ru/ Басня в исполнении]`,
      "Волк и Ягнёнок (Крылов)"
    );

    expect(piece?.shape).toBe("verse");
    // The numeral title, the collection link, the rule, the indents, the
    // manuscript date and the declamation section are all gone; the four lines
    // of Krylov are not.
    expect(piece?.text).toBe(
      [
        "У сильного всегда бессильный виноват:",
        "Но мы Истории не пишем;",
        "",
        "Ягненок в жаркий день зашел к ручью напиться;",
        "И надобно ж беде случиться,",
      ].join("\n")
    );
  });

  it("finds the body of a verse template whatever order its parameters come in", () => {
    // `{{v||body|year}}` and `{{poemx|title|body|date}}` disagree on position,
    // and hard-coding either was wrong. The body is the parameter with lines.
    const poemx = wikitextToPiece(`{{poemx|Осень|
Уж небо осенью дышало,
Уж реже солнышко блистало,
|1833}}`);
    expect(poemx?.shape).toBe("verse");
    expect(poemx?.text).toBe("Уж небо осенью дышало,\nУж реже солнышко блистало,");
  });

  it("drops a magic word instead of reading it as the opening line", () => {
    // `__NOTOC__` stood at the top of Garshin's story on the first run.
    const piece = wikitextToPiece(`__NOTOC__

I

— Именем его императорского величества!`);
    expect(piece?.text.startsWith("I")).toBe(true);
    expect(piece?.text).not.toContain("NOTOC");
  });

  it("drops a first line that only repeats the title", () => {
    // Tolstoy's page opens with `ПОСЛЕ БАЛА`, and boks prints the title itself.
    const piece = wikitextToPiece(
      `ПОСЛЕ БАЛА

— Вот вы говорите, что человек не может сам по себе понять, что хорошо.

Так заговорил всеми уважаемый Иван Васильевич.`,
      "После бала (Толстой)"
    );
    expect(piece?.text.startsWith("— Вот вы говорите")).toBe(true);
  });

  it("drops a repeated title on a page reached through an edition list", () => {
    // Those pages are titled `<work> (<author>)/<edition>`. Taking the
    // trailing parenthesis off first removed `(СО)` and left `(Плещеев)` in
    // the middle of the name, so the comparison never matched and twenty-one
    // poems printed their opening line twice - once as the title, once as the
    // text.
    const piece = wikitextToPiece(
      `На сердце злоба накипела

От заученых этих фраз!

Слова! Слова! А чуть до дела,`,
      "На сердце злоба накипела (Плещеев)/РС 1862 (СО)"
    );
    expect(piece?.text.startsWith("От заученых")).toBe(true);
  });

  it("keeps a one-line poem whose only line is its title", () => {
    // The mirror image of the case above: dropping it would delete the poem.
    const piece = wikitextToPiece(`<poem>Молчание</poem>`, "Молчание (Анненский)");
    expect(piece?.text).toBe("Молчание");
  });

  it("strips the ragged left margin that leading whitespace leaves", () => {
    // One stanza of `Парус` sat half a space right of the others.
    const piece = wikitextToPiece(`{{v||
Белеет парус одинокой
 Играют волны — ветер свищет,
|1832}}`);
    expect(piece?.text).toBe("Белеет парус одинокой\nИграют волны — ветер свищет,");
  });

  it("drops a bold heading printed inside the poem", () => {
    // Krylov's fables head the `<poem>` block with their collection and their
    // numeral, in bold rather than in a template. Stripping the bold markers
    // first made both into opening lines of the fable.
    const piece = wikitextToPiece(
      `<poem>
    ''' [[Басни (Крылов)#Книга первая|Басни. Книга первая]] '''
    ''' XVII. Мартышка и очки '''

     Мартышка к старости слаба глазами стала;
                   А у людей она слыхала,
</poem>`,
      "Мартышка и очки (Крылов)"
    );
    expect(piece?.text).toBe(
      "Мартышка к старости слаба глазами стала;\nА у людей она слыхала,"
    );
  });

  it("drops a bold heading that carries an indent marker", () => {
    // Two of Krylov's fables write the same heading as `:'''...'''`. The
    // indent marker used to be stripped after the heading rule ran, so the
    // rule never recognised the line and `Басни. Книга первая` was published
    // as the fable's opening.
    const piece = wikitextToPiece(
      `<poem>
:'''[[Басни (Крылов)#Книга первая|Басни. Книга первая]]'''

:'''V. Ларчик'''

:::Случается нередко нам
:::::\t\t ________
:К кому-то принесли от мастера Ларец.
</poem>`,
      "Ларчик (Крылов)"
    );
    // And the typographic rule between stanzas is a blank line, not a row of
    // underscores.
    expect(piece?.text).toBe("Случается нередко нам\n\nК кому-то принесли от мастера Ларец.");
  });

  it("keeps a bold word that belongs to the verse", () => {
    const piece = wikitextToPiece(`<poem>\nОн крикнул '''нет''' и вышел вон,\nи дверь закрылась.\n</poem>`);
    expect(piece?.text).toBe("Он крикнул нет и вышел вон,\nи дверь закрылась.");
  });

  it("drops the publisher's imprint from the top of the page", () => {
    // Gorky's pages open with the Soviet edition's imprint, which was being
    // served as the first paragraph of the story - the English corpus's
    // imported editor's introduction, in a different costume.
    const piece = wikitextToPiece(
      `«Собрание сочинений в тридцати томах»: Государственное издательство художественной литературы; Москва; 1949

Том 11. По Руси. Рассказы 1912—1917

Июльский день начался очень интересно — хоронили генерала.

Гроб, покрытый венками, везли огромные вороные лошади.`,
      "Зрители (Горький)"
    );
    expect(piece?.text.startsWith("Июльский день")).toBe(true);
    expect(piece?.text).not.toContain("издательство");
  });

  it("keeps a story that merely mentions a publisher", () => {
    const piece = wikitextToPiece(
      `Он работал в типографии на Мойке, и это его вполне устраивало.

Каждое утро он приходил первым и уходил последним, не жалуясь.`
    );
    expect(piece?.text.startsWith("Он работал в типографии")).toBe(true);
  });

  it("cuts the scholarship off at its heading", () => {
    const piece = wikitextToPiece(`Текст рассказа.

== Примечания ==
Печатается по тексту первой публикации.`);
    expect(piece?.text).toBe("Текст рассказа.");
  });

  it("unwraps a link to its words and deletes a file", () => {
    const piece = wikitextToPiece(
      `Он шёл по [[Невский проспект|Невскому проспекту]] один.
[[Файл:nevsky.jpg|thumb|Невский]]`
    );
    expect(piece?.text).toBe("Он шёл по Невскому проспекту один.");
  });

  it("returns null when a page has no text at all", () => {
    expect(wikitextToPiece(`{{Отексте|АВТОР=[[Кто-то]]}}\n[[Категория:Стихотворения]]`)).toBeNull();
  });
});

describe("readRedactionHub", () => {
  it("reads an edition list as a hub rather than as a poem", () => {
    // `Silentium!` carries every poetry category and not one line of Tyutchev.
    const hub = readRedactionHub(
      `{{Отексте|АВТОР=[[Фёдор Иванович Тютчев]]|НАЗВАНИЕ=Silentium!}}
* {{Современник|год=1836|часть=[[/С 1836 (ДО)|Silentium!]]}}
* {{Тютчев:ПСС (1987)|страницы=105|часть=[[/ПСС 1987 (СО)|Silentium!]]}}
* {{Тютчев:ПСС 2002—2005|том=1|часть=[[/ПСС 2002 (СО)|Silentium!]]}}

[[Категория:Стихотворения]]
[[Категория:Списки редакций]]`
    );
    expect(hub?.hub).toBe(true);
    expect(hub?.variants[0]).toBe("ПСС 2002 (СО)");
    expect(hub?.variants).not.toContain("С 1836 (ДО)");
  });

  it("reads an edition list headed anything at all as a hub", () => {
    // Lermontov's `Дума` heads its list `Авторские и издательские редакции
    // текста`, which matched no marker, so the list was published as the poem.
    // Two subpage links is the signal that survives new labels.
    const hub = readRedactionHub(
      `{{Отексте|АВТОР=[[Михаил Юрьевич Лермонтов]]|НАЗВАНИЕ=Дума}}
==Авторские и издательские редакции текста==
* [[/ИПСС 1914 (ВТ)|Дума]]
* [[/Сочинения 1954 (СО)|Дума]]`
    );
    expect(hub?.hub).toBe(true);
    expect(hub?.variants[0]).toBe("Сочинения 1954 (СО)");
  });

  it("leaves a work that merely links a subpage alone", () => {
    expect(
      readRedactionHub(`Текст рассказа, целиком здесь.\n\nСм. также [[/Черновик|черновик]].`)
    ).toBeNull();
  });
});

describe("rankVariants", () => {
  it("prefers modern orthography, then the later edition", () => {
    expect(rankVariants(["ПСС 1903 (ДО)", "ПСС 1975", "ПСС 1987 (СО)"])[0]).toBe("ПСС 1987 (СО)");
  });

  it("refuses pre-reform orthography and stress-marked school editions", () => {
    expect(rankVariants(["ПСС 1903 (ДО)", "ПСС 1975 (ВТ, с ударениями)"])).toEqual([]);
  });
});

describe("rejectPiece", () => {
  const prose = (text: string) => ({ text, shape: "prose" as const });
  const long = (body: string) => body.repeat(Math.ceil(300 / body.length));

  it("accepts a clean piece", () => {
    expect(rejectPiece(prose(long("Он шёл по улице и думал о своём. ")), limits)).toBeNull();
  });

  it("refuses a piece with markup left in it, because that is a reader's problem", () => {
    for (const bad of ["{{poem-title|XIII}}", "[[Категория:Стихотворения]]", "<div class=\"indent\">", "&nbsp;", "https://example.org"]) {
      const piece = prose(`${long("Ровный русский текст для длины. ")}${bad}`);
      expect(rejectPiece(piece, limits), bad).not.toBeNull();
    }
  });

  it("refuses pre-reform orthography", () => {
    // A different reading experience, and not the one this app promises.
    expect(rejectPiece(prose(long("Онъ шелъ по улицѣ и думалъ о своемъ. ")), limits)?.reason).toBe(
      "pre-reform orthography"
    );
  });

  it("refuses editorial apparatus that reads like prose", () => {
    // The lesson from the English corpus, where an editor's introduction
    // passed every length check and was imported as literature.
    const piece = prose(long("Печатается по тексту первой публикации, с исправлениями. "));
    expect(rejectPiece(piece, limits)?.reason).toBe("reads as editorial apparatus, not the work");
  });

  it("refuses a piece that is not mainly Russian", () => {
    expect(rejectPiece(prose(long("This is an English sentence about nothing. ")), limits)?.reason).toBe(
      "not mainly in Russian"
    );
  });

  it("refuses anything outside the length window", () => {
    expect(rejectPiece(prose("Коротко."), limits)?.reason).toBe("too short to be a piece");
    expect(rejectPiece(prose(long("Текст. ").repeat(200)), limits)?.reason).toBe(
      "longer than fifteen minutes"
    );
  });
});
