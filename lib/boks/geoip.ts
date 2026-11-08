import { Reader, type CountryResponse } from "mmdb-lib";
import { countryFrom } from "@/lib/boks/geo";

/**
 * The visitor's country on our own server, where no Cloudflare edge adds it.
 *
 * Until 2026-11-07 the country came from Cloudflare's `CF-IPCountry`. On the
 * self-hosted server the app looks the connecting address up in a country
 * database instead: DB-IP's free "IP to Country Lite" (CC BY 4.0,
 * https://db-ip.com), a file on the server (`BOKS_GEOIP_DB`) that
 * `deploy/ops/geoip.sh` refreshes every month. Only the two-letter code
 * leaves this function; the address is not stored or logged.
 *
 * No file, an unreadable file, or an address it does not know: null, which is
 * what the visit recorded before - the site never fails over a country.
 */
type CountryRecord = CountryResponse;

const recheckMs = 60 * 60 * 1000; // a refreshed file is picked up within an hour

let cached: { path: string; mtimeMs: number; checkedAt: number; reader: Reader<CountryRecord> | null } | null = null;

/**
 * The connecting address. Caddy trusts no proxy in front of it, so it replaces
 * any `X-Forwarded-For` the client sent with the address it saw; the last
 * entry is that one either way.
 */
export function clientIp(forwardedFor: string | null | undefined) {
  const parts = (forwardedFor ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  const ip = parts[parts.length - 1];
  return ip && /^[0-9a-f:.]+$/i.test(ip) && ip.length <= 45 ? ip : null;
}

export function countryInDatabase(reader: { get(ip: string): { country?: { iso_code?: string } } | null }, ip: string) {
  try {
    return countryFrom(reader.get(ip)?.country?.iso_code);
  } catch {
    return null;
  }
}

export async function lookupCountry(ip: string | null, path = process.env.BOKS_GEOIP_DB) {
  if (!ip || !path) return null;
  const reader = await loadReader(path);
  return reader ? countryInDatabase(reader, ip) : null;
}

async function loadReader(path: string) {
  const now = Date.now();
  if (cached?.path === path && now - cached.checkedAt < recheckMs) return cached.reader;
  try {
    const { readFile, stat } = await import("node:fs/promises");
    const { mtimeMs } = await stat(path);
    if (cached?.path === path && cached.mtimeMs === mtimeMs) {
      cached.checkedAt = now;
      return cached.reader;
    }
    cached = { path, mtimeMs, checkedAt: now, reader: new Reader<CountryRecord>(await readFile(path)) };
  } catch {
    cached = { path, mtimeMs: 0, checkedAt: now, reader: null };
  }
  return cached.reader;
}
