import { describe, expect, it } from "vitest";
import { maxBokCharacters } from "@/lib/boks/contracts";
import {
  digestImportKey,
  importKeyFromFileName,
  parseCatalogueFiles,
  parseFrontMatter,
} from "@/lib/boks/import/parse-catalogue";

const story = "Abel had lit the same ninety-four lamps for thirty-one years.\n\nHe walked anyway.";

function markdown(fields: string, body = story) {
  return `---\n${fields}\n---\n${body}\n`;
}

describe("parseFrontMatter", () => {
  it("reads plain fields and strips quotes", () => {
    const fields = parseFrontMatter(`title: The Lamplighter\nauthor: "Abel Mensah"\nid: 'lamp-01'`);
    expect(fields).toMatchObject({ title: "The Lamplighter", author: "Abel Mensah", id: "lamp-01" });
  });

  it("keeps a colon inside a value", () => {
    expect(parseFrontMatter("title: Signal: Lost").title).toBe("Signal: Lost");
  });

  it("folds a > block onto one line and keeps a | block's breaks", () => {
    expect(parseFrontMatter("hook: >\n  one line\n  and another").hook).toBe("one line and another");
    expect(parseFrontMatter("hook: |\n  one line\n  and another").hook).toBe("one line\nand another");
  });

  it("ignores comments and blank lines", () => {
    expect(parseFrontMatter("# a note\n\ntitle: Kept")).toEqual({ title: "Kept" });
  });
});

describe("importKeyFromFileName", () => {
  it("slugs a human file name", () => {
    expect(importKeyFromFileName("01 - The Lamplighter's Last Round.md")).toBe("01-the-lamplighter-s-last-round");
  });

  it("drops a directory prefix", () => {
    expect(importKeyFromFileName("catalogue/2026/lamp.txt")).toBe("lamp");
  });

  it("always yields something", () => {
    expect(importKeyFromFileName("!!!.md")).toBe("untitled");
  });
});

describe("parseCatalogueFiles", () => {
  it("reads a file per bok, with the byline for that piece", () => {
    const parsed = parseCatalogueFiles([
      { name: "lamplighter.md", content: markdown("title: The Lamplighter\nauthor: Abel Mensah\nhook: One night.") },
    ]);

    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      importKey: "lamplighter",
      title: "The Lamplighter",
      authorName: "Abel Mensah",
      hook: "One night.",
    });
    expect(parsed.rows[0].text).toBe(story);
  });

  it("treats the byline as optional, because the publisher's @handle is the attribution", () => {
    const parsed = parseCatalogueFiles([{ name: "anon.md", content: markdown("title: No Byline") }]);
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows[0].authorName).toBe("");
  });

  it("accepts the field names a catalogue export actually uses", () => {
    const parsed = parseCatalogueFiles([
      { name: "x.md", content: markdown("name: Exported\nbyline: R. Ochs\nteaser: A line.\ncatalogue_id: PEN-0042") },
    ]);

    expect(parsed.rows[0]).toMatchObject({
      importKey: "PEN-0042",
      title: "Exported",
      authorName: "R. Ochs",
      hook: "A line.",
    });
  });

  it("takes the title from a leading heading when front matter omits it", () => {
    const parsed = parseCatalogueFiles([
      { name: "heading.md", content: markdown("author: Abel Mensah", `# The Lamplighter\n\n${story}`) },
    ]);

    expect(parsed.problems).toEqual([]);
    expect(parsed.rows[0].title).toBe("The Lamplighter");
    expect(parsed.rows[0].text).toBe(story);
  });

  it("names the file and the fix when a file cannot be read", () => {
    const parsed = parseCatalogueFiles([{ name: "bare.md", content: "Just prose, no front matter." }]);

    expect(parsed.rows).toEqual([]);
    expect(parsed.problems[0].source).toBe("bare.md");
    expect(parsed.problems[0].problem).toMatch(/front-matter/);
  });

  it("refuses a bok that will not fit in fifteen minutes", () => {
    const parsed = parseCatalogueFiles([
      { name: "long.md", content: markdown("title: Too Long", "a".repeat(maxBokCharacters + 1)) },
    ]);

    expect(parsed.rows).toEqual([]);
    expect(parsed.problems[0].problem).toMatch(/over the 20,000/);
  });

  it("refuses a date it cannot read rather than guessing one", () => {
    const parsed = parseCatalogueFiles([
      { name: "dated.md", content: markdown("title: Dated\ndate: last tuesday") },
    ]);

    expect(parsed.problems[0].problem).toMatch(/Could not read the date/);
  });

  it("keeps a date it can read, so a catalogue keeps its own history", () => {
    const parsed = parseCatalogueFiles([
      { name: "dated.md", content: markdown("title: Dated\npublished: 1998-04-02") },
    ]);

    expect(parsed.problems).toEqual([]);
    expect(parsed.rows[0].createdAt).toBe("1998-04-02");
  });

  it("reports two files that claim one import key instead of dropping one", () => {
    const parsed = parseCatalogueFiles([
      { name: "a.md", content: markdown("title: First\nid: same-key") },
      { name: "b.md", content: markdown("title: Second\nid: same-key") },
    ]);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].title).toBe("First");
    expect(parsed.problems[0].problem).toMatch(/Two boks claim the import key "same-key"/);
  });

  it("reads a JSONL export, one object per line", () => {
    const content = [
      JSON.stringify({ id: "p-1", title: "One", author: "A. One", hook: "h", text: story }),
      "",
      JSON.stringify({ id: "p-2", title: "Two", text: story }),
    ].join("\n");

    const parsed = parseCatalogueFiles([{ name: "export.jsonl", content }]);

    expect(parsed.problems).toEqual([]);
    expect(parsed.rows.map((row) => row.importKey)).toEqual(["p-1", "p-2"]);
    expect(parsed.rows[0].authorName).toBe("A. One");
  });

  it("gives a JSONL row without an id a stable key, so a repeated export imports once", () => {
    const line = JSON.stringify({ title: "Keyless", author: "A. One", text: story });
    const first = parseCatalogueFiles([{ name: "a.jsonl", content: line }]);
    const second = parseCatalogueFiles([{ name: "b.jsonl", content: line }]);

    expect(first.rows[0].importKey).toBe(second.rows[0].importKey);
    expect(first.rows[0].importKey).toBe(digestImportKey("Keyless", "A. One", story.slice(0, 200)));
  });

  it("points at the line when one JSONL row is broken, and keeps the rest", () => {
    const content = [JSON.stringify({ id: "ok", title: "Fine", text: story }), "{not json"].join("\n");
    const parsed = parseCatalogueFiles([{ name: "export.jsonl", content }]);

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.problems[0].source).toBe("export.jsonl:2");
    expect(parsed.problems[0].problem).toMatch(/Not valid JSON/);
  });

  it("reads where the rights come from, under any of the words a source would use", () => {
    const parsed = parseCatalogueFiles([
      { name: "a.md", content: markdown("title: A\nrights: Project Gutenberg #1342, public domain") },
      { name: "b.md", content: markdown("title: B\nlicense: CC BY-SA 4.0") },
      { name: "c.md", content: markdown("title: C\nsource: Permission from the estate") },
      { name: "d.md", content: markdown("title: D") },
    ]);

    expect(parsed.problems).toEqual([]);
    expect(parsed.rows.map((row) => row.rightsNote)).toEqual([
      "Project Gutenberg #1342, public domain",
      "CC BY-SA 4.0",
      "Permission from the estate",
      // Empty: the batch's own note applies.
      "",
    ]);
  });

  it("reads a whole mixed drop in one go", () => {
    const parsed = parseCatalogueFiles([
      { name: "one.md", content: markdown("title: One\nauthor: A") },
      { name: "two.txt", content: markdown("title: Two\nauthor: B") },
      { name: "rest.jsonl", content: JSON.stringify({ id: "three", title: "Three", text: story }) },
    ]);

    expect(parsed.problems).toEqual([]);
    expect(parsed.rows.map((row) => row.title)).toEqual(["One", "Two", "Three"]);
  });
});
