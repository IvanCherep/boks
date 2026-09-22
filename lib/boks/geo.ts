/**
 * The two-letter country Cloudflare attaches to a request, or null.
 *
 * `XX` is Cloudflare's "could not tell" and `T1` is Tor; neither is a country,
 * and storing them as one would put a fake place in the audience table.
 */
export function countryFrom(header: string | null | undefined) {
  const code = (header ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== "XX" && code !== "T1" ? code : null;
}
