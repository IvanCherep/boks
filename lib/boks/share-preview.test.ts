import { describe, expect, it } from "vitest";
import {
  loadBokForShare,
  shareDescription,
  shareDescriptionLimit,
  shareReadingNote,
  shareTitle,
  sharedBokFromRow,
  sharedBokIdFrom,
} from "@/lib/boks/share-preview";

const chekhov = {
  id: "2932b319-e0ec-41f7-b23f-46ab506fcce9",
  title: "Тоска",
  authorName: "Антон Чехов",
  text: "Вечерние сумерки. Крупный мокрый снег лениво кружится около только что зажжённых фонарей и тонким мягким пластом ложится на крыши, лошадиные спины, плечи, шапки.",
  minutes: 7,
  language: "ru",
};

describe("how a shared bok reads in a messenger", () => {
  it("says the piece and who wrote it", () => {
    expect(shareTitle(chekhov)).toBe("Тоска — Антон Чехов");
  });

  it("falls back to the title alone when the piece carries no byline", () => {
    expect(shareTitle({ title: "Прощай, немытая Россия", authorName: null })).toBe("Прощай, немытая Россия");
    expect(shareTitle({ title: "   ", authorName: null })).toBe("A bok");
  });

  it("opens with the piece itself, as one line", () => {
    const description = shareDescription("Бор сосновый\nв стране одинокой стоит;\nв нём ручья\nне найдёшь.");
    expect(description).toBe("Бор сосновый в стране одинокой стоит; в нём ручья не найдёшь.");
  });

  it("cuts at a word and marks the cut, so no client truncates mid-word", () => {
    // Long enough to need cutting: the fixture above is 160 characters and the
    // allowance is 200, so it passes through whole.
    const prose = `${chekhov.text} ${chekhov.text}`;
    const long = shareDescription(prose);
    expect(long.length).toBeLessThanOrEqual(shareDescriptionLimit + 1);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toMatch(/[\s,;:—–-]…$/);
    expect(chekhov.text.startsWith(long.slice(0, 20))).toBe(true);
    expect(long.length).toBeGreaterThan(150);
  });

  it("keeps a short poem whole rather than adding an ellipsis to nothing", () => {
    expect(shareDescription("Мороз и солнце; день чудесный!")).toBe("Мороз и солнце; день чудесный!");
  });

  it("names the length and the language under the title", () => {
    expect(shareReadingNote(chekhov)).toBe("7 minutes · Russian");
    expect(shareReadingNote({ minutes: 1, language: "en" })).toBe("1 minute · English");
    expect(shareReadingNote({ minutes: 0, language: null })).toBe("1 minute");
  });
});

describe("reading a bok for a preview", () => {
  it("refuses an id that is not one, without asking the server", async () => {
    let called = false;
    const result = await loadBokForShare("../../etc/passwd", {
      url: "https://example.test",
      key: "key",
      fetchImpl: (async () => {
        called = true;
        return new Response("[]");
      }) as typeof fetch,
    });
    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  it("returns null rather than throwing when the lookup fails - the page must render", async () => {
    const failing = (async () => {
      throw new Error("Failed to fetch");
    }) as typeof fetch;
    await expect(
      loadBokForShare(chekhov.id, { url: "https://example.test", key: "key", fetchImpl: failing })
    ).resolves.toBeNull();
  });

  it("returns null for an empty answer, which is what a hidden or missing bok gives", async () => {
    const empty = (async () => new Response("[]", { status: 200 })) as typeof fetch;
    await expect(
      loadBokForShare(chekhov.id, { url: "https://example.test", key: "key", fetchImpl: empty })
    ).resolves.toBeNull();
  });

  it("maps a row from the published view", async () => {
    const row = {
      id: chekhov.id,
      title: "Тоска",
      author_name: "Антон Чехов",
      text: chekhov.text,
      minutes: 7,
      language: "ru",
    };
    const ok = (async () => new Response(JSON.stringify([row]), { status: 200 })) as typeof fetch;
    const bok = await loadBokForShare(chekhov.id, { url: "https://example.test", key: "key", fetchImpl: ok });
    expect(bok).toEqual(chekhov);
  });

  it("drops a row with no text, which cannot be previewed", () => {
    expect(sharedBokFromRow({ id: chekhov.id, title: "x", text: "   " })).toBeNull();
    expect(sharedBokFromRow(null)).toBeNull();
  });
});

describe("reading the id out of a link a messenger damaged", () => {
  const id = "a1e3baf7-44da-4867-a817-088f1cdfbd26";

  it("reads the id out of the link Telegram actually sent", () => {
    // Verbatim from a real share: the share text glued to the URL, no space.
    expect(sharedBokIdFrom(`${id}Read`)).toBe(id);
    expect(sharedBokIdFrom(`${id}Read%20%22%D0%9A%D0%BE%D0%BD%D0%BA%D1%83%D1%80%D1%81%22%20on%20boks`)).toBe(id);
  });

  it("leaves a clean id as it is", () => {
    expect(sharedBokIdFrom(id)).toBe(id);
    expect(sharedBokIdFrom(id.toUpperCase())).toBe(id);
  });

  it("does not invent an id where there is none", () => {
    expect(sharedBokIdFrom("not-a-uuid")).toBe("not-a-uuid");
    expect(sharedBokIdFrom("%E0%A4%A")).toBe("%E0%A4%A");
  });
});
