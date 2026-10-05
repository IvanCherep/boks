/**
 * Recording mode: a format with no interface over it, for filming a piece.
 *
 * Asked for with `?recording=1` on any reader address (`/series`, `/b/<id>`,
 * `/?bok=<id>`). The flag only says what the admin would like drawn; whether it
 * applies is the reader's role, which comes from `get_boks_user_context` - a
 * reader who adds the flag gets the ordinary player. Nothing is unlocked by
 * it: the close button, the bar and the transport go, and their keys stay.
 */
export const recordingParam = "recording";

export function recordingRequested(search: string) {
  const value = new URLSearchParams(search).get(recordingParam);
  return value !== null && ["", "1", "true", "yes", "on"].includes(value.toLowerCase());
}
