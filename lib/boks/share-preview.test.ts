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

  it("keeps a short poem's lines, whole", () => {
    const description = shareDescription("Бор сосновый\nв стране одинокой стоит;\nв нём ручья\nне найдёшь.");
    expect(description).toBe("Бор сосновый\nв стране одинокой стоит;\nв нём ручья\nне найдёшь.");
  });

  it("opens a longer poem with its first lines and an ellipsis", () => {
    const poem = "заходит смерть\nи просит наточить косу,\n\nты острослов\nсумеешь ли с железом\nя понимаю что сейчас спасу";
    expect(shareDescription(poem)).toBe("заходит смерть\nи просит наточить косу,\nты острослов\nсумеешь ли с железом…");
  });

  it("does not put an ellipsis after a full stop", () => {
    expect(shareDescription("Раз.\nДва.\nТри.\nЧетыре.\nПять.")).toBe("Раз.\nДва.\nТри.\nЧетыре…");
  });

  it("runs prose into one paragraph", () => {
    const prose = "Первый абзац рассказа, длинный, как бывает у прозы, и уж точно длиннее восьмидесяти знаков в одной строке.\nВторой абзац.";
    expect(shareDescription(prose)).not.toContain("\n");
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

  it("asks once more after a server error, so a blip does not cost the preview", async () => {
    const row = { id: chekhov.id, title: "Тоска", author_name: "Антон Чехов", text: chekhov.text, minutes: 7, language: "ru" };
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      return calls === 1 ? new Response("busy", { status: 503 }) : new Response(JSON.stringify([row]), { status: 200 });
    }) as typeof fetch;
    const bok = await loadBokForShare(chekhov.id, { url: "https://example.test", key: "key", fetchImpl: flaky });
    expect(bok?.title).toBe("Тоска");
    expect(calls).toBe(2);
  });

  it("does not ask again when the bok is simply not there", async () => {
    let calls = 0;
    const missing = (async () => {
      calls += 1;
      return new Response("[]", { status: 200 });
    }) as typeof fetch;
    await loadBokForShare(chekhov.id, { url: "https://example.test", key: "key", fetchImpl: missing });
    expect(calls).toBe(1);
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
    expect(bok).toEqual({ ...chekhov, slug: null });
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

describe("a bok named by its slug", () => {
  it("reads a slug from the path, leaving glued text behind", async () => {
    const { sharedBokRefFrom } = await import("@/lib/boks/share-preview");
    expect(sharedBokRefFrom("neznakomka-blok")).toEqual({ slug: "neznakomka-blok" });
    expect(sharedBokRefFrom(encodeURIComponent("neznakomka-blokЧитай"))).toEqual({ slug: "neznakomka-blok" });
    expect(sharedBokRefFrom("cc7e3800-3567-42c1-ba08-8554a345e25cRead")).toEqual({ id: "cc7e3800-3567-42c1-ba08-8554a345e25c" });
    expect(sharedBokRefFrom("../../etc")).toBeNull();
  });

  it("looks a slug up by slug, and nothing else", async () => {
    const asked: string[] = [];
    const fetchImpl = (async (input: string) => {
      asked.push(String(input));
      return new Response(JSON.stringify([{ id: "cc7e3800-3567-42c1-ba08-8554a345e25c", title: "коса", author_name: "Алексей Прохоров", text: "Текст", minutes: 1, language: "ru", slug: "kosa-prokhorov" }]));
    }) as unknown as typeof fetch;
    const bok = await loadBokForShare("kosa-prokhorov", { url: "https://example.test", key: "key", fetchImpl });
    expect(bok?.slug).toBe("kosa-prokhorov");
    expect(asked[0]).toContain("published_boks?slug=eq.kosa-prokhorov&");
    expect(await loadBokForShare("kosa prokhorov", { url: "https://example.test", key: "key", fetchImpl })).toBeNull();
  });
});

describe("the line under a shared bok's title", () => {
  it("says what boks is, in the bok's language, short enough for two lines", async () => {
    const { sharePitch, sharePitchFor } = await import("@/lib/boks/share-preview");
    expect(sharePitchFor({ language: "en" })).toBe(sharePitch.en);
    expect(sharePitchFor({ language: "ru" })).toBe(sharePitch.ru);
    expect(sharePitchFor({ language: null })).toBe(sharePitch.ru);
    for (const line of Object.values(sharePitch)) {
      expect(line.length).toBeLessThanOrEqual(150);
      expect(line).not.toMatch(/—/);
    }
  });
});
