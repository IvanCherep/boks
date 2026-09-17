import { describe, expect, it } from "vitest";
import { formatReaderBody } from "@/components/boks/reader-text";

describe("formatReaderBody", () => {
  it("keeps ordinary paragraphs as they were written", () => {
    const blocks = formatReaderBody("First paragraph.\n\nSecond paragraph.");

    expect(blocks).toEqual([
      { kind: "prose", lines: ["First paragraph."] },
      { kind: "prose", lines: ["Second paragraph."] },
    ]);
  });

  it("keeps a stanza whose lines are as long as wrapped prose", () => {
    // Teasdale's "Tides": about forty characters a line, which the old rule
    // reflowed into a paragraph. A poem cannot survive that.
    const stanza = [
      "Love in my heart was a fresh tide flowing",
      "Where the starlike sea gulls soar;",
      "The sun was keen and the foam was blowing",
      "High on the rocky shore.",
    ].join("\n");

    const blocks = formatReaderBody(stanza);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("verse");
    expect(blocks[0].lines).toHaveLength(4);
  });

  it("keeps long-line free verse as lines", () => {
    // Whitman's lines are longer than a wrapped paragraph's, and uneven.
    const whitman = [
      "AMERICA always!",
      "Always our own feuillage!",
      "Always Florida's green peninsula! Always the priceless delta of Louisiana!",
      "Always the cotton-fields of Alabama and Texas!",
    ].join("\n");

    const blocks = formatReaderBody(whitman);

    expect(blocks[0].kind).toBe("verse");
    expect(blocks[0].lines).toHaveLength(4);
  });

  it("reflows prose wrapped at any of the usual widths", () => {
    // The case the verse rule must never break: an author pastes work that was
    // wrapped by whatever wrote it.
    const sentence =
      "The municipal archive kept rain in numbered glass tubes and the drizzles were thin and " +
      "silver, while the thunderstorms were dark enough to hum quietly in their long wooden " +
      "drawers all evening, which is how the keeper learned to tell one year from another.";

    for (const width of [58, 64, 70, 76, 80]) {
      const wrapped: string[] = [];
      let line = "";
      for (const word of sentence.split(" ")) {
        if (`${line} ${word}`.trim().length > width) {
          wrapped.push(line.trim());
          line = word;
        } else {
          line = `${line} ${word}`;
        }
      }
      if (line.trim()) wrapped.push(line.trim());

      const blocks = formatReaderBody(wrapped.join("\n"));
      expect(blocks[0].kind, `wrapped at ${width}`).toBe("prose");
      expect(blocks[0].lines, `wrapped at ${width}`).toHaveLength(1);
    }
  });

  it("reflows hard-wrapped prose into one paragraph", () => {
    // Exported from a document that wrapped at a fixed column. Rendering each
    // line as its own paragraph is what makes pasted work look broken.
    const wrapped = [
      "The municipal archive kept rain in numbered glass tubes and the",
      "drizzles were thin and silver, while the thunderstorms were dark",
      "enough to hum quietly in their long wooden drawers all evening.",
    ].join("\n");

    const blocks = formatReaderBody(wrapped);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("prose");
    expect(blocks[0].lines).toHaveLength(1);
    expect(blocks[0].lines[0]).toContain("glass tubes and the drizzles");
  });

  it("keeps the line breaks of a stanza", () => {
    const stanza = ["Light on the sill.", "A cup, half drunk.", "The morning waits.", "Nobody speaks."].join("\n");

    const blocks = formatReaderBody(stanza);

    expect(blocks[0].kind).toBe("verse");
    expect(blocks[0].lines).toHaveLength(4);
  });

  it("drops a first block that only repeats the title", () => {
    const blocks = formatReaderBody("Oranges at Noon\n\nEvery Tuesday, Pavel bought two oranges.", "Oranges at Noon");

    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines[0]).toContain("Every Tuesday");
  });

  it("ignores punctuation and case when matching the title", () => {
    const blocks = formatReaderBody("ORANGES AT NOON!\n\nThe body.", "Oranges at Noon");
    expect(blocks).toHaveLength(1);
  });

  it("keeps a first paragraph that merely starts with the title", () => {
    const blocks = formatReaderBody("Oranges at Noon were his one ritual.\n\nThe body.", "Oranges at Noon");
    expect(blocks).toHaveLength(2);
  });

  it("gathers a run of short fragments into one passage", () => {
    const exchange = ["He waited.", "She did not.", "The train left.", "Nobody moved."].join("\n\n");

    const blocks = formatReaderBody(exchange);

    // Four separate paragraphs would put a full gap between each beat and turn
    // the page into a ladder.
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lines).toHaveLength(4);
  });

  it("leaves two fragments alone - a run needs three", () => {
    const blocks = formatReaderBody("He waited.\n\nShe did not.");
    expect(blocks).toHaveLength(2);
  });

  it("treats a full short sentence as its own paragraph when it is long enough", () => {
    const long = "He waited for the train that never came, and he did not mind it at all.";
    const blocks = formatReaderBody([long, long, long].join("\n\n"));

    expect(blocks).toHaveLength(3);
  });

  it("normalises stray carriage returns and trailing spaces", () => {
    const blocks = formatReaderBody("First.   \r\n   \r\n\r\nSecond.");

    expect(blocks).toEqual([
      { kind: "prose", lines: ["First."] },
      { kind: "prose", lines: ["Second."] },
    ]);
  });

  it("returns nothing for an empty body", () => {
    expect(formatReaderBody("")).toEqual([]);
    expect(formatReaderBody("   \n\n  ")).toEqual([]);
  });

  it("survives a body that is only its own title", () => {
    expect(formatReaderBody("Oranges at Noon", "Oranges at Noon")).toEqual([]);
  });
});

describe("a title that is also the first line", () => {
  it("drops a repeated title block whether or not the edition printed ё", () => {
    // This fires when the repeat is its own block, which is what pasted text
    // looks like. Editions disagree on the diaeresis, so the comparison has to
    // read `ё` and `е` as one letter or the rule works for some poems and not
    // for others.
    const blocks = formatReaderBody(
      "Кот поет, глаза прищуря\n\nМальчик дремлет на ковре,\nНа дворе играет буря,\nВетер свищет на дворе.",
      "Кот поёт, глаза прищуря"
    );
    expect(blocks[0].lines[0]).toBe("Мальчик дремлет на ковре,");
  });
});

describe("verse in couplets", () => {
  it("keeps a poem whose stanzas are two lines long", () => {
    // Blok's `Предчувствую Тебя` leaves a blank line after every second line.
    // Deciding block by block, each pair fell below the three-line minimum and
    // the poem was reflowed into two-line paragraphs. Any poem in couplets
    // breaks the same way in any language.
    const blocks = formatReaderBody(
      [
        "Весь горизонт в огне — и ясен нестерпимо,",
        "И молча жду, — тоскуя и любя.",
        "",
        "Весь горизонт в огне, и близко появленье,",
        "Но страшно мне: изменишь облик Ты,",
        "",
        "И дерзкое возбудишь подозренье,",
        "Сменив в конце привычные черты.",
      ].join("\n")
    );
    expect(blocks.every((block) => block.kind === "verse")).toBe(true);
    expect(blocks[0].lines).toHaveLength(2);
  });

  it("still reflows a paragraph that happens to be wrapped onto two lines", () => {
    // The mirror case: the whole-body vote must not turn wrapped prose into
    // verse. A wrapping program fills every line to its margin.
    const blocks = formatReaderBody(
      [
        "Через базарную площадь идёт полицейский надзиратель Очумелов в новой",
        "шинели и с узелком в руке, а за ним шагает рыжий городовой с решетом.",
        "",
        "Кругом тишина, на площади ни души, и открытые двери лавок и кабаков",
        "глядят на свет божий уныло, как голодные пасти голодных животных.",
      ].join("\n")
    );
    expect(blocks.every((block) => block.kind === "prose")).toBe(true);
  });
});
