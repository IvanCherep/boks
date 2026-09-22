/**
 * "🇷🇸 Serbia" from "RS".
 *
 * The flag is built from the two regional-indicator letters, which every
 * current platform renders as a flag; the name comes from the browser's own
 * locale data, so nothing is maintained here. An unknown code - there are none
 * today, but Cloudflare adds them - falls back to the code itself.
 */
export function countryFlag(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

let names: Intl.DisplayNames | null = null;

export function countryName(code: string) {
  if (code === "unknown") return "Unknown";
  try {
    names ??= new Intl.DisplayNames(["en"], { type: "region" });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

export function countryLabel(code: string) {
  const flag = countryFlag(code);
  return flag ? `${flag} ${countryName(code)}` : countryName(code);
}
