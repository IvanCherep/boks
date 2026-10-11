import { describe, expect, it } from "vitest";
import {
  allNarrators,
  narrationSettings,
  narratorFor,
  type AuthorGender,
  type NarrationLanguage,
} from "@/components/boks/cinema/voices";

describe("who reads a boks", () => {
  it("casts by the author's gender in both languages", () => {
    expect(narratorFor("ru", "male").name).toBe("Alex Bell");
    expect(narratorFor("ru", "female").name).toBe("Mariia");
    expect(narratorFor("en", "male").name).toBe("Jerry B.");
    expect(narratorFor("en", "female").name).toBe("Sha");
  });

  it("has exactly one voice for every combination", () => {
    const seen = new Set<string>();
    for (const language of ["ru", "en"] as NarrationLanguage[]) {
      for (const gender of ["male", "female"] as AuthorGender[]) {
        const voice = narratorFor(language, gender);
        expect(seen.has(`${language}/${gender}`)).toBe(false);
        seen.add(`${language}/${gender}`);
        expect(voice.voiceId).toMatch(/^[A-Za-z0-9]{20}$/);
      }
    }
    // Four by the rule, and the one British voice beside it.
    expect(allNarrators()).toHaveLength(5);
  });

  it("reads a British classic in a British voice where there is one", () => {
    expect(narratorFor("en", "male", "british").name).toBe("Julian");
    // No British woman's voice yet: the ordinary English one reads it.
    expect(narratorFor("en", "female", "british").name).toBe("Sha");
    // Asking for nothing never gets the British voice.
    expect(narratorFor("en", "male").name).toBe("Jerry B.");
  });

  it("keeps every voice at one credit per character", () => {
    // Some Russian voices in the library bill at two or three times. That is
    // invisible on one piece and hundreds of dollars across the catalogue, so
    // a swap that quietly carries a multiplier should fail here first.
    for (const voice of allNarrators()) expect(voice.rate, voice.name).toBe(1);
  });

  it("holds verse tighter than prose", () => {
    // An expressive reading invents its own rhythm, which is fine in a story
    // and fatal in a stanza.
    expect(narrationSettings.verse.stability).toBeGreaterThan(narrationSettings.prose.stability);
    expect(narrationSettings.expressive.stability).toBeLessThan(narrationSettings.prose.stability);
  });
});
