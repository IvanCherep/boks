import { describe, expect, it } from "vitest";
import { isWorkshopClosed, moveInQueue, notesLimits, notesProblem, queueOf } from "@/lib/boks/author-desk/server-rules";

describe("the notes' limits, as the database checks them", () => {
  it("takes empty notes and the Workshop's own shape", () => {
    expect(notesProblem({})).toBeNull();
    expect(notesProblem({
      about: "О море 🌊 и عربى",
      plan: [{ id: "a", text: "Начало", done: false }],
      thoughts: [{ text: "мысль", at: "2026-11-22T10:00:00Z" }],
      materials: [{ id: "m", kind: "fact", text: "Факт", source: "книга" }],
    })).toBeNull();
  });

  it("refuses what is not an object, too big, too long, too many or nested", () => {
    expect(notesProblem(null)).toMatch(/object/);
    expect(notesProblem([])).toMatch(/object/);
    expect(notesProblem({ about: "я".repeat(notesLimits.chars + 1) })).toMatch(/2000/);
    expect(notesProblem({ about: "я".repeat(notesLimits.chars) })).toBeNull();
    expect(notesProblem({ plan: Array.from({ length: 201 }, (_, i) => ({ id: String(i), text: "", done: false })) })).toMatch(/200 entries/);
    expect(notesProblem({ thoughts: Array.from({ length: 40 }, () => ({ text: "x".repeat(1999) })) })).toMatch(/64 KB/);
    expect(notesProblem(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, ""])))).toMatch(/too many/);
    expect(notesProblem({ about: { deep: true } })).toMatch(/nested/);
    expect(notesProblem({ plan: [{ id: "a", text: ["x"] }] })).toMatch(/nested/);
  });

  it("counts characters, not UTF-16 units, as Postgres does", () => {
    expect(notesProblem({ about: "😀".repeat(notesLimits.chars) })).toBeNull();
  });
});

describe("the author's queue", () => {
  const pieces = [{ id: "c", queuePos: 3 }, { id: "x", queuePos: null }, { id: "a", queuePos: 1 }, { id: "b", queuePos: 2 }];

  it("is the pieces with a place, by place", () => {
    expect(queueOf(pieces)).toEqual(["a", "b", "c"]);
  });

  it("moves one piece up or down, and stays put at the ends", () => {
    expect(moveInQueue(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveInQueue(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(moveInQueue(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveInQueue(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(moveInQueue(["a", "b"], "z", 1)).toEqual(["a", "b"]);
  });
});

describe("telling the Workshop's refusal apart", () => {
  it("knows the closed Workshop from other refusals", () => {
    expect(isWorkshopClosed({ code: "42501", message: "The Workshop is open to authors the editors invited.", hint: "workshop_closed" })).toBe(true);
    expect(isWorkshopClosed({ code: "42501", message: "This piece is not yours or no longer exists." })).toBe(false);
    expect(isWorkshopClosed(null)).toBe(false);
  });
});
