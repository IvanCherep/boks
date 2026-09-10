export function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("no such table")) {
    return "The prototype database is not ready yet. Run the D1 migration locally or publish the saved version so the platform can apply it.";
  }
  if (message.includes("no such column")) {
    return "The prototype database needs the latest migration before these metrics can run.";
  }
  return message;
}

export function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export function estimateMinutes(body: string) {
  const words = body.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.min(15, Math.ceil(words / 220)));
}

export function numberParam(url: URL, key: string, fallback: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number(url.searchParams.get(key)) || fallback));
}

export function searchPattern(query: string) {
  return `%${query.replaceAll("%", "").replaceAll("_", "").toLowerCase()}%`;
}

export function integerPayload(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}
