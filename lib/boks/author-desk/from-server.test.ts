import { describe, expect, it } from "vitest";
import { editorStepOf, outcomeOf, queueFromServer, workFromServer, type ServerPiece } from "./from-server";
import { canQueue, isStale, stageOf, textKey } from "./workflow";

const text = "Снег пошёл в апреле, как будто кто-то забыл\nвыключить зиму, уходя из дома.\nИ мы стояли у окна, и было\nсмешно и страшно, как в начале знакомства.";

function piece(over: Partial<ServerPiece> = {}): ServerPiece {
  return {
    id: "b1",
    title: "Снег",
    text,
    status: "draft",
    coverRequested: false,
    coverVersion: null,
    createdAt: "2026-11-20T10:00:00Z",
    updatedAt: "2026-11-21T10:00:00Z",
    form: "poem",
    shelvedAt: null,
    queuePos: null,
    notes: null,
    voice: null,
    decision: null,
    series: null,
    importedFrom: null,
    ...over,
  };
}
const voice = (current = true) => ({ file: "take-1.webm", durationMs: 41_400, source: "teleprompter" as const, name: null, at: "2026-11-21T11:00:00Z", current });
const series = (state: "accepted" | "sent" | "published", workStatus: string | null = null) => ({
  state,
  acceptedAt: "2026-11-21T12:00:00Z",
  sentAt: state === "accepted" ? null : "2026-11-22T12:00:00Z",
  publishedAt: state === "published" ? "2026-11-23T12:00:00Z" : null,
  workId: state === "accepted" ? null : "w1",
  revision: state === "accepted" ? null : 1,
  workStatus,
  seriesPiece: state === "accepted" ? null : "SeriesTokenAbcdefghijklmn",
});

describe("a piece's place with the editors", () => {
  it("is nowhere while it is a draft", () => {
    expect(editorStepOf(piece())).toEqual({ step: null, revising: false });
  });
  it("is in the queue once sent with the voice", () => {
    expect(editorStepOf(piece({ status: "pending_review", coverRequested: true })).step).toBe("queued");
  });
  it("is not in the queue when it went to review some other, older way", () => {
    expect(editorStepOf(piece({ status: "pending_review", coverRequested: false })).step).toBe(null);
  });
  it("is being drawn once accepted", () => {
    expect(editorStepOf(piece({ status: "pending_review", coverRequested: true, series: series("accepted") }))).toEqual({ step: "production", revising: false });
  });
  it("is ready for the author once sent back", () => {
    expect(editorStepOf(piece({ status: "pending_review", coverRequested: true, series: series("sent", "ready") })).step).toBe("approval");
  });
  it("is being fixed when the author asked for changes to the sent Series", () => {
    expect(editorStepOf(piece({ status: "pending_review", coverRequested: true, series: series("sent", "changes_requested") }))).toEqual({ step: "production", revising: true });
  });
  it("is out once published, with or without a Series", () => {
    expect(editorStepOf(piece({ status: "published" })).step).toBe("published");
    expect(editorStepOf(piece({ status: "published", series: series("published") })).step).toBe("published");
  });
});

describe("the editors' answer", () => {
  it("shows a return for the recording while the piece is back with the author", () => {
    const outcome = outcomeOf(piece({ decision: { decision: "changes", kind: "voice", note: "Шум на 0:40", at: "2026-11-22T09:00:00Z" } }));
    expect(outcome).toMatchObject({ kind: "changes", category: "voice", reason: "Шум на 0:40" });
  });
  it("shows a refusal", () => {
    expect(outcomeOf(piece({ status: "rejected", decision: { decision: "refused", kind: "law", note: "Закон", at: "2026-11-22T09:00:00Z" } }))?.kind).toBe("declined");
  });
  it("hides an old answer once the piece is with the editors again", () => {
    expect(outcomeOf(piece({ status: "pending_review", coverRequested: true, decision: { decision: "changes", kind: "text", note: "x", at: "2026-11-22T09:00:00Z" } }))).toBeUndefined();
  });
  it("takes an unknown kind as «Другое»", () => {
    expect(outcomeOf(piece({ decision: { decision: "changes", kind: "something-new", note: "x", at: "2026-11-22T09:00:00Z" } }))?.category).toBe("other");
  });
});

describe("a piece in the Workshop's model", () => {
  it("keeps the chosen recording current or stale as the server says", () => {
    const fresh = workFromServer(piece({ voice: voice(true) }));
    expect(fresh.chosenTake).toBe("take-1.webm");
    expect(isStale(fresh.takes[0], fresh.text)).toBe(false);
    expect(canQueue(fresh)).toEqual({ ok: true });
    const stale = workFromServer(piece({ voice: voice(false) }));
    expect(isStale(stale.takes[0], stale.text)).toBe(true);
    expect(canQueue(stale)).toEqual({ ok: false, missing: ["stale"] });
  });
  it("rounds the length to seconds", () => {
    expect(workFromServer(piece({ voice: voice() })).takes[0].seconds).toBe(41);
  });
  it("reads notes defensively", () => {
    const work = workFromServer(
      piece({
        notes: {
          about: "О гараже",
          plan: [{ id: "p1", text: "Запах бензина", done: true }],
          thoughts: [{ text: "мысль", at: "2026-11-20T10:00:00Z" }],
          materials: [
            { id: "m1", kind: "image", text: "Банка с гайками", pinTo: "Запах бензина" },
            { id: "m2", kind: "nonsense", text: "дропнуть" },
          ],
        },
      })
    );
    expect(work.idea.concept?.about).toBe("О гараже");
    expect(work.idea.concept?.plan).toHaveLength(1);
    expect(work.idea.notes).toHaveLength(1);
    expect(work.materials.map((item) => item.id)).toEqual(["m1"]);
  });
  it("survives empty and odd notes", () => {
    expect(workFromServer(piece({ notes: {} })).idea.concept).toBeNull();
    expect(workFromServer(piece({ notes: { plan: "x" as never, thoughts: null as never } })).idea.notes).toEqual([]);
  });
  it("shelves only what is not with the editors", () => {
    expect(workFromServer(piece({ shelvedAt: "2026-11-22T00:00:00Z" })).shelved).toBe(true);
    expect(workFromServer(piece({ shelvedAt: "2026-11-22T00:00:00Z", status: "pending_review", coverRequested: true })).shelved).toBe(false);
  });
  it("lets any text, even four short lines, go to the voice stage; an empty one stays in the text stage", () => {
    expect(stageOf(workFromServer(piece()))).toBe("voice");
    expect(stageOf(workFromServer(piece({ text: "Тихо.\nСнег.\nОкно.\nТы." })))).toBe("voice");
    expect(stageOf(workFromServer(piece({ text: "  \n " })))).toBe("text");
  });
  it("keeps a 120-character title and emoji as they are", () => {
    const title = "🌧".repeat(10) + "Д".repeat(110);
    expect(workFromServer(piece({ title })).title).toBe(title);
  });
  it("marks textKey against the text it read", () => {
    expect(workFromServer(piece({ voice: voice() })).takes[0].textKey).toBe(textKey(text));
  });
});

describe("the author's queue", () => {
  it("follows the author's order and puts unplaced pieces last by date", () => {
    const pieces = [
      piece({ id: "a", status: "pending_review", coverRequested: true, queuePos: 2 }),
      piece({ id: "b", status: "pending_review", coverRequested: true, queuePos: 1 }),
      piece({ id: "c", status: "pending_review", coverRequested: true, queuePos: null, updatedAt: "2026-11-23T00:00:00Z" }),
      piece({ id: "d", status: "pending_review", coverRequested: true, queuePos: null, updatedAt: "2026-11-22T00:00:00Z" }),
      piece({ id: "e", status: "pending_review", coverRequested: true, series: series("accepted") }),
      piece({ id: "f" }),
    ];
    expect(queueFromServer(pieces)).toEqual(["b", "a", "d", "c"]);
  });
});
