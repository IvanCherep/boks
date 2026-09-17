import { describe, expect, it } from "vitest";
import { readableBoksError } from "@/lib/boks/errors";

describe("readableBoksError", () => {
  it("passes through a message the database wrote for a person", () => {
    // What `supabase-js` actually rejects with: a plain object, not an Error.
    const refusal = { code: "23505", message: "That nickname is taken.", details: null, hint: null };
    expect(readableBoksError(refusal, "Could not save settings.")).toBe("That nickname is taken.");
  });

  it("passes through a rule named by an RPC", () => {
    expect(readableBoksError({ message: "A nickname has to start with a letter." }, "x")).toBe(
      "A nickname has to start with a letter."
    );
  });

  it("reads a real Error too", () => {
    expect(readableBoksError(new Error("Daily limit reached."), "x")).toBe("Daily limit reached.");
  });

  it("hides a constraint violation, which names internal tables", () => {
    const leak = {
      code: "23514",
      message: 'new row for relation "user_profiles" violates check constraint "user_profiles_handle_format"',
    };
    expect(readableBoksError(leak, "Could not save settings.")).toBe("Could not save settings.");
  });

  it("hides the other shapes of database plumbing", () => {
    const fallback = "Could not save settings.";
    for (const message of [
      'duplicate key value violates unique constraint "user_profiles_handle_unique_idx"',
      'relation "user_profiles" does not exist',
      "permission denied for table user_profiles",
      'invalid input syntax for type uuid: ""',
      "new row violates row-level security policy for table \"reels\"",
      "invalid JWT: unable to parse or verify signature",
    ]) {
      expect(readableBoksError({ message }, fallback)).toBe(fallback);
    }
  });

  it("falls back when there is no message at all", () => {
    expect(readableBoksError({}, "Could not save settings.")).toBe("Could not save settings.");
    expect(readableBoksError(null, "Could not save settings.")).toBe("Could not save settings.");
    expect(readableBoksError({ message: "   " }, "Could not save settings.")).toBe("Could not save settings.");
  });
});
