import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Agents navigate by the paths and commands the standing docs name: AGENTS.md
// routes a change to a file, docs/testing.md to a script. A rename that leaves
// the doc behind sends the next session to a file that is not there, and
// nothing else notices. History docs (project-state, ADRs, handovers, thesis,
// research) are exempt: they rightly name files that were later removed.

const root = path.resolve(import.meta.dirname, "..");

const historyDocs = new Set(["docs/project-state.md"]);

function standingDocs(): string[] {
  const inDir = (dir: string) =>
    readdirSync(path.join(root, dir))
      .filter((name) => name.endsWith(".md"))
      .map((name) => `${dir}/${name}`);
  return [
    "AGENTS.md",
    "CONTEXT.md",
    "README.md",
    ...inDir("docs"),
    ...inDir("docs/agents"),
    ...inDir("specs"),
  ].filter((doc) => !historyDocs.has(doc));
}

// A backticked path under a top-level source directory. Placeholders such as
// `docs/adr/NNNN-slug.md` or `docs/poetry/<slug>/` are templates, not files.
const repoPath = /`((?:app|components|lib|scripts|docs|supabase|specs|public|build)\/[^`\s]*)`/g;
const placeholder = /[<>*{}]|NNNN|YYYY/;
const npmScript = /npm run ([a-z][a-z0-9:-]*)/g;

const scripts = Object.keys(
  (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts,
);

describe("standing docs", () => {
  for (const doc of standingDocs()) {
    const text = readFileSync(path.join(root, doc), "utf8");

    it(`${doc} names only paths that exist`, () => {
      const missing = [...text.matchAll(repoPath)]
        .map((match) => match[1].replace(/[.,:;]$/, ""))
        .filter((ref) => !placeholder.test(ref))
        .filter((ref) => !existsSync(path.join(root, ref)));
      expect([...new Set(missing)]).toEqual([]);
    });

    it(`${doc} names only npm scripts that exist`, () => {
      const missing = [...text.matchAll(npmScript)]
        .map((match) => match[1])
        .filter((name) => !scripts.includes(name));
      expect([...new Set(missing)]).toEqual([]);
    });
  }
});
