/**
 * Turns whatever a Supabase call rejected with into a sentence worth showing.
 *
 * Nothing thrown by `supabase-js` is an `Error`: a PostgREST or GoTrue failure
 * arrives as a plain object carrying `message` and `code`. Every screen tested
 * it with `error instanceof Error ? error.message : "Could not ..."`, so every
 * refusal the database had written a message for - "That nickname is taken.",
 * a daily limit, a length rule - was replaced by a generic line. The reader was
 * told that something went wrong but never what, which is indistinguishable
 * from the action having silently done nothing.
 */

/**
 * Fragments that mark a message as database plumbing rather than something a
 * person asked for. These reach a reader as noise at best, and at worst name
 * internal tables, so they are replaced by the caller's fallback. They are the
 * signature of a bug on our side; the deliberate `raise exception` messages in
 * the RPCs read as ordinary sentences and pass through.
 */
const internalMessageMarkers = [
  "violates",
  "duplicate key",
  "syntax error",
  "does not exist",
  "permission denied for",
  "invalid input syntax",
  "null value in column",
  "out of range",
  "deadlock",
  "could not serialize",
  "jwt",
  "row-level security",
];

function messageOf(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

export function isReadableBoksError(message: string) {
  if (!message.trim()) return false;
  const normalized = message.toLowerCase();
  return !internalMessageMarkers.some((marker) => normalized.includes(marker));
}

/**
 * `fallback` is used when the failure carries no message, or one only a
 * developer should read. It should say which action failed, since the message
 * it replaces would have been the only clue.
 */
export function readableBoksError(error: unknown, fallback: string) {
  const message = messageOf(error).trim();
  return isReadableBoksError(message) ? message : fallback;
}
