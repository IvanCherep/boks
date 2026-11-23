/**
 * The offer and the consents are stored as text in a small markdown subset
 * (`docs/legal/author/*.md`, `docs/author-agreements.md`): `# ` the title,
 * `> ` the subtitle, `## ` and `### ` headings, paragraphs, `- ` bullets,
 * `| a | b |` tables, and `**bold**` inside a line. Nothing else is markup,
 * so a legal text never renders differently from how it reads.
 */

export type Inline = { text: string; bold: boolean }[];
export type LegalBlock =
  | { kind: "title"; text: string }
  | { kind: "subtitle"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; inline: Inline }
  | { kind: "ul"; items: Inline[] }
  | { kind: "table"; head: Inline[]; rows: Inline[][] };

export function inline(text: string): Inline {
  const parts: Inline = [];
  const re = /\*\*(.+?)\*\*/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index), bold: false });
    parts.push({ text: m[1], bold: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), bold: false });
  return parts;
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => inline(cell.trim()));

export function parseLegalMarkdown(source: string): LegalBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: LegalBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i += 1; continue; }
    if (trimmed.startsWith("### ")) { blocks.push({ kind: "h3", text: trimmed.slice(4).trim() }); i += 1; continue; }
    if (trimmed.startsWith("## ")) { blocks.push({ kind: "h2", text: trimmed.slice(3).trim() }); i += 1; continue; }
    if (trimmed.startsWith("# ")) { blocks.push({ kind: "title", text: trimmed.slice(2).trim() }); i += 1; continue; }
    if (trimmed.startsWith("> ")) { blocks.push({ kind: "subtitle", text: trimmed.slice(2).trim() }); i += 1; continue; }
    if (trimmed.startsWith("- ")) {
      const items: Inline[] = [];
      while (i < lines.length && lines[i].trim().startsWith("- ")) { items.push(inline(lines[i].trim().slice(2))); i += 1; }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (trimmed.startsWith("|")) {
      const head = cells(trimmed);
      i += 1;
      if (i < lines.length && /^\|?\s*:?-{3,}/.test(lines[i].trim())) i += 1;
      const rows: Inline[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(cells(lines[i])); i += 1; }
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    // A paragraph runs to the next blank line or block.
    const text: string[] = [trimmed];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3} |> |- |\|)/.test(lines[i].trim())) { text.push(lines[i].trim()); i += 1; }
    blocks.push({ kind: "p", inline: inline(text.join(" ")) });
  }
  return blocks;
}
