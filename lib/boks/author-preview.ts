/**
 * What a shared author link (`/@prokhorov`) looks like in a messenger.
 *
 * Read with the publishable key through `get_boks_author`, which anon may
 * call; bounded and swallowing every failure, like `share-preview.ts` - a
 * preview is never worth a broken page.
 */
export type SharedAuthor = {
  handle: string;
  /** The writer's name when the account publishes one writer; else "@handle". */
  name: string;
  boks: number;
  titles: string[];
};

type AuthorAnswer = {
  authorHandle?: unknown;
  totalBoks?: unknown;
  writers?: unknown;
  boks?: unknown;
};

export function sharedAuthorFromAnswer(handle: string, answer: AuthorAnswer | null | undefined): SharedAuthor | null {
  if (!answer || typeof answer !== "object") return null;
  const boks = Array.isArray(answer.boks) ? (answer.boks as { title?: unknown; authorName?: unknown }[]) : [];
  const total = Number(answer.totalBoks) || boks.length;
  if (!total) return null;
  const writers = Array.isArray(answer.writers) ? (answer.writers as { name?: unknown }[]) : [];
  const names = new Set(
    (writers.length ? writers.map((writer) => writer.name) : boks.map((bok) => bok.authorName)).filter(
      (name): name is string => typeof name === "string" && name.trim() !== ""
    )
  );
  const shownHandle = typeof answer.authorHandle === "string" && answer.authorHandle ? answer.authorHandle : handle;
  return {
    handle: shownHandle,
    name: names.size === 1 ? [...names][0] : `@${shownHandle}`,
    boks: total,
    titles: boks.map((bok) => (typeof bok.title === "string" ? bok.title.trim() : "")).filter(Boolean).slice(0, 3),
  };
}

/** One line under the name, in the writer's language as far as it shows. */
export function authorPreviewDescription(author: SharedAuthor) {
  const russian = /[а-яё]/i.test(`${author.name} ${author.titles.join(" ")}`);
  const quoted = author.titles.map((title) => `«${title}»`).join(", ");
  if (russian) {
    const n = author.boks % 100;
    const word = n % 10 === 1 && n !== 11 ? "бок" : n % 10 >= 2 && n % 10 <= 4 && (n < 12 || n > 14) ? "бока" : "боков";
    return `${author.boks} ${word} на boks${quoted ? `: ${quoted}${author.boks > author.titles.length ? " и другие" : ""}` : ""}.`;
  }
  return `${author.boks} ${author.boks === 1 ? "bok" : "boks"} on boks${quoted ? `: ${quoted}${author.boks > author.titles.length ? " and more" : ""}` : ""}.`;
}

export async function loadAuthorForShare(
  handle: string,
  options: { url?: string; key?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<SharedAuthor | null> {
  const url = options.url ?? (import.meta.env.VITE_SUPABASE_URL as string | undefined);
  const key = options.key ?? (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined);
  const bare = handle.replace(/^@+/, "").toLowerCase();
  if (!url || !key || !/^[a-z0-9_.-]{1,40}$/.test(bare)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2000);
  try {
    const restBase = options.url ? `${url}/rest/v1` : (globalThis.process?.env?.BOKS_INTERNAL_REST_URL || `${url}/rest/v1`);
    const response = await (options.fetchImpl ?? fetch)(`${restBase}/rpc/get_boks_author`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ p_handle: bare, p_limit: 3 }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return sharedAuthorFromAnswer(bare, (await response.json()) as AuthorAnswer);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
