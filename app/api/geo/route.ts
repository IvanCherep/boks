import { countryFrom } from "@/lib/boks/geo";
import { clientIp, lookupCountry } from "@/lib/boks/geoip";

/**
 * The visitor's country, as a two-letter code, so the client can attach it to
 * the visit it records.
 *
 * A browser cannot know its own country - only the network can. Behind
 * Cloudflare it arrives as `CF-IPCountry`; on our own server (since
 * 2026-11-07) the app looks the connecting address up in a country database
 * (`lib/boks/geoip.ts`). The address is used for that lookup only: it is not
 * returned, stored or logged.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const country =
    countryFrom(request.headers.get("cf-ipcountry") ?? request.headers.get("x-country")) ??
    (await lookupCountry(clientIp(request.headers.get("x-forwarded-for"))));
  return Response.json(
    { country },
    // Per visitor and per network: never cached anywhere it could be shared.
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
