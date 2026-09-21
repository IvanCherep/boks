/**
 * An id this app can always make.
 *
 * `crypto.randomUUID()` is not always there: it needs a **secure context**, so
 * it is missing over plain HTTP and inside some in-app or proxying browsers
 * (Yandex Browser's traffic-saving mode is one), and it only arrived in
 * Chromium 92. Every call site here wants a visitor id, a session id or a
 * request id - labels, not secrets - so an unguarded call was trading the whole
 * app against a convenience: it throws while the reader is booting, and the
 * reader has no error boundary between it and a blank page.
 *
 * Reported from the field: a white screen in Yandex Browser where the site and
 * the API host were both reachable.
 */
export function randomBoksId(): string {
  const cryptoApi = typeof globalThis.crypto === "object" ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    try {
      return cryptoApi.randomUUID();
    } catch {
      // Some embedded browsers expose the method and then refuse it.
    }
  }
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    try {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
      return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch {
      // Fall through to the last resort.
    }
  }
  // Not a UUID and not uniform, but unique enough for a label on one device,
  // which is the whole job.
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
