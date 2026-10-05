/**
 * A `@nickname` as stored, shown and compared.
 *
 * Handles arrive with and without the `@` - typed by a person, stored by an
 * older migration, carried in a shared link - so every comparison and every
 * label goes through these two rather than its own regular expression.
 */

/** The handle without any leading `@`. */
export function bareHandle(handle: string | null | undefined) {
  return (handle ?? "").replace(/^@+/, "");
}

/** The handle as a reader sees it: exactly one `@`. Empty in, empty out. */
export function atHandle(handle: string | null | undefined) {
  const bare = bareHandle(handle);
  return bare ? `@${bare}` : "";
}
