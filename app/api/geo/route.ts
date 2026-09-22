import { countryFrom } from "@/lib/boks/geo";

/**
 * The visitor's country, as Cloudflare sees it.
 *
 * A browser cannot know its own country - only the network can, from the IP
 * address - and Cloudflare adds that to every request it hands the Worker as
 * `CF-IPCountry`. This returns just the two-letter code, so the client can
 * attach it to the visit it records. The IP address itself is never read,
 * returned or stored.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return Response.json(
    { country: countryFrom(request.headers.get("cf-ipcountry")) },
    // Per visitor and per network: never cached anywhere it could be shared.
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
