import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  docxXmlToText,
  episodeTitle,
  isSupportedAuthorFile,
  pieceFromText,
  readDocxText,
  splitIntoEpisodes,
} from "@/lib/boks/author/author-files";

describe("pieceFromText", () => {
  it("takes a plain text file as it is, with no title of its own", () => {
    const piece = pieceFromText("кот.txt", "Кот\r\n\r\n\r\n\r\nЖил-был кот.   \n");
    expect(piece).toEqual({ fileName: "кот.txt", title: "", text: "Кот\n\nЖил-был кот.", authorName: "" });
  });

  it("reads title and author from front matter", () => {
    const piece = pieceFromText("a.md", "---\ntitle: Дождь\nauthor: Мира Вале\n---\nШёл дождь.");
    expect(piece.title).toBe("Дождь");
    expect(piece.authorName).toBe("Мира Вале");
    expect(piece.text).toBe("Шёл дождь.");
  });

  it("takes a Markdown file's opening heading as its title", () => {
    const piece = pieceFromText("a.md", "# The Lamp\n\nIt was late.");
    expect(piece.title).toBe("The Lamp");
    expect(piece.text).toBe("It was late.");
  });

  it("leaves a heading in a .txt file alone", () => {
    expect(pieceFromText("a.txt", "# Not a heading\nText").title).toBe("");
  });
});

describe("isSupportedAuthorFile", () => {
  it("accepts the formats the cabinet reads", () => {
    expect(isSupportedAuthorFile("a.TXT")).toBe(true);
    expect(isSupportedAuthorFile("a.md")).toBe(true);
    expect(isSupportedAuthorFile("a.docx")).toBe(true);
    expect(isSupportedAuthorFile("a.doc")).toBe(false);
    expect(isSupportedAuthorFile("a.pdf")).toBe(false);
  });
});

describe("splitIntoEpisodes", () => {
  it("leaves a text that fits as one part", () => {
    expect(splitIntoEpisodes("Short.", 100)).toEqual(["Short."]);
  });

  it("cuts between paragraphs, every part within the limit, nothing lost", () => {
    const paragraphs = Array.from({ length: 30 }, (_, index) => `Paragraph ${index} `.repeat(5).trim());
    const text = paragraphs.join("\n\n");
    const parts = splitIntoEpisodes(text, 300);
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((part) => expect(part.length).toBeLessThanOrEqual(300));
    expect(parts.join("\n\n")).toBe(text);
  });

  it("cuts one long paragraph between sentences", () => {
    const text = Array.from({ length: 40 }, (_, index) => `Sentence number ${index}.`).join(" ");
    const parts = splitIntoEpisodes(text, 120);
    parts.forEach((part) => expect(part.length).toBeLessThanOrEqual(120));
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text);
    expect(parts.every((part) => part.endsWith("."))).toBe(true);
  });

  it("cuts a sentence with no stop between words", () => {
    const text = "word ".repeat(100).trim();
    const parts = splitIntoEpisodes(text, 50);
    parts.forEach((part) => expect(part.length).toBeLessThanOrEqual(50));
    expect(parts.join(" ")).toBe(text);
  });
});

describe("episodeTitle", () => {
  it("numbers the parts in the interface language", () => {
    expect(episodeTitle("Дождь", 1, "ru")).toBe("Дождь. Часть 2");
    expect(episodeTitle("Rain", 0, "en")).toBe("Rain. Part 1");
  });
});

/** A zip with one deflated entry, the way Word writes `word/document.xml`. */
function zipOf(name: string, content: string) {
  const data = Buffer.from(content, "utf8");
  const compressed = deflateRawSync(data);
  const nameBytes = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + nameBytes.length + compressed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  const zip = Buffer.concat([local, nameBytes, compressed, central, nameBytes, end]);
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
}

const documentXml =
  '<?xml version="1.0"?><w:document xmlns:w="x"><w:body>' +
  '<w:p><w:r><w:t>Дождь</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Шёл </w:t></w:r><w:r><w:t>дождь &amp; ветер.</w:t></w:r></w:p>' +
  "<w:p/>" +
  "<w:p><w:r><w:t>Строка</w:t><w:br/><w:t>вторая</w:t></w:r></w:p>" +
  "</w:body></w:document>";

describe("docx", () => {
  it("turns Word paragraphs into a bok's paragraphs", () => {
    expect(docxXmlToText(documentXml)).toBe("Дождь\n\nШёл дождь & ветер.\n\nСтрока\nвторая");
  });

  it("reads the text out of a real .docx archive", async () => {
    await expect(readDocxText(zipOf("word/document.xml", documentXml))).resolves.toBe(
      "Дождь\n\nШёл дождь & ветер.\n\nСтрока\nвторая"
    );
  });

  it("refuses an archive that is not a Word document", async () => {
    await expect(readDocxText(zipOf("other.xml", "<x/>"))).rejects.toThrow("not a Word document");
  });
});
