/**
 * Telling "your network cannot reach our server" apart from every other error.
 *
 * It matters because the two need opposite words. An ordinary failure is ours
 * to apologise for; an unreachable host is something the reader can act on -
 * another network, a VPN - and something we can fix by moving the address.
 * Until 2026-09-21 boks said neither: the first thing it does on load is call
 * `…supabase.co`, that call had no timeout, and a reader whose provider blocks
 * the host sat on the word "Loading" for as long as they were willing to wait.
 * Reported from Russia, on a provider where the site loads and the API host
 * does not.
 *
 * The strings below are what browsers actually say, which is not what the specs
 * say: Chromium raises "Failed to fetch", Safari "Load failed", Firefox
 * "NetworkError when attempting to fetch resource". None of them is
 * translated, and none of them carries a code, so matching text is the only
 * option available to a client.
 */

/** Marks an operation this app gave up on, so the reason survives the throw. */
export const unreachableMarker = "boks-unreachable";

const networkPhrases = [
  unreachableMarker,
  "failed to fetch",
  "networkerror",
  "load failed",
  "network request failed",
  "err_connection",
  "err_timed_out",
  "err_name_not_resolved",
  "err_internet_disconnected",
  "err_tunnel_connection_failed",
  "net::",
  "fetch failed",
  "the network connection was lost",
  "timeout",
  "timed out",
];

export function isUnreachableBoksError(error: unknown): boolean {
  const text =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? `${error.message} ${(error.cause instanceof Error && error.cause.message) || ""}`
        : typeof error === "object" && error && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
  if (!text) return false;
  const lowered = text.toLowerCase();
  return networkPhrases.some((phrase) => lowered.includes(phrase));
}

/**
 * Fails an operation that is taking so long the reader has stopped believing
 * the screen. Eight seconds: long enough for a slow mobile connection to
 * finish a round trip to London, short enough that nobody stares at nothing.
 */
export const bootTimeoutMs = 8000;

export function withUnreachableTimeout<T>(
  work: Promise<T>,
  what: string,
  timeoutMs: number = bootTimeoutMs
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${unreachableMarker}: ${what} did not answer within ${timeoutMs} ms`)),
      timeoutMs
    );
  });
  // The timer is cleared either way: an unref'd interval keeps a mobile browser
  // awake, and a rejected race leaves the other promise running regardless.
  return Promise.race([work, limit]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}
