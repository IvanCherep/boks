import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLegalMarkdown } from "./legal-markdown";

describe("legal markdown", () => {
  it("reads the subset", () => {
    const blocks = parseLegalMarkdown("# Оферта\n\n> Редакция\n\n## 1. Термины\n\n1.1. **Платформа** — сервис\nпродолжение.\n\n- один\n- два\n\n| a | b |\n|---|---|\n| **x** | y |\n");
    expect(blocks.map((b) => b.kind)).toEqual(["title", "subtitle", "h2", "p", "ul", "table"]);
    expect(blocks[3]).toEqual({ kind: "p", inline: [{ text: "1.1. ", bold: false }, { text: "Платформа", bold: true }, { text: " — сервис продолжение.", bold: false }] });
    const table = blocks[5];
    expect(table.kind === "table" && table.rows[0][0]).toEqual([{ text: "x", bold: true }]);
  });

  it("parses every author document with one title and no stray markup", () => {
    for (const name of ["offer", "processing", "distribution"]) {
      const source = readFileSync(`docs/legal/author/${name}.md`, "utf8");
      const blocks = parseLegalMarkdown(source);
      expect(blocks.filter((b) => b.kind === "title")).toHaveLength(1);
      expect(blocks[0].kind).toBe("title");
      expect(source).not.toMatch(/—/);
      const text = JSON.stringify(blocks);
      expect(text).not.toMatch(/\*\*|\]\(|^#/m);
    }
  });
});
