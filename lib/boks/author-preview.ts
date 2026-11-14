import { sharePitch } from "@/lib/boks/share-preview";

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
  /** The photo the author set (`author_spaces.photo`), as `/a/<handle>/photo?v=<photoVersion>`. */
  photoVersion?: number | null;
  /** The page's own link preview card, `/l/<token>/f/<name>-share.jpg`; it follows the author through a rename. */
  shareCard?: string | null;
  /** Its moving version for og:video, `/l/<token>/f/<name>-share.mp4`. */
  shareVideo?: string | null;
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

/**
 * The line under an author link's title: what boks is, like every bok link
 * (`sharePitch`, 2026-11-09). English for an author whose name and titles are
 * in English, Russian otherwise.
 */
export function authorSharePitch(author: SharedAuthor) {
  return /[а-яё]/i.test(`${author.name} ${author.titles.join(" ")}`) ? sharePitch.ru : sharePitch.en;
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

type RpcOptions = { url?: string; key?: string; timeoutMs?: number; fetchImpl?: typeof fetch };

/**
 * One anon RPC, bounded; null on any failure. Server side it goes over the
 * private network. A timeout or a server error is tried once more, so a
 * database blip does not leave a shared link with a bare preview.
 */
async function publicRpc<T>(name: string, body: Record<string, unknown>, options: RpcOptions): Promise<T | null> {
  const url = options.url ?? (import.meta.env.VITE_SUPABASE_URL as string | undefined);
  const key = options.key ?? (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined);
  if (!url || !key) return null;
  const restBase = options.url ? `${url}/rest/v1` : (globalThis.process?.env?.BOKS_INTERNAL_REST_URL || `${url}/rest/v1`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2000);
    try {
      const response = await (options.fetchImpl ?? fetch)(`${restBase}/rpc/${name}`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status >= 500) continue;
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      // timeout or network: try again
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

export function bareHandle(handle: string) {
  const bare = handle.replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9_.-]{1,40}$/.test(bare) ? bare : null;
}

export async function loadAuthorForShare(handle: string, options: RpcOptions = {}): Promise<SharedAuthor | null> {
  const bare = bareHandle(handle);
  if (!bare) return null;
  const [answer, page] = await Promise.all([
    publicRpc<AuthorAnswer>("get_boks_author", { p_handle: bare, p_limit: 3 }, options),
    publicRpc<{ name?: unknown; photoVersion?: unknown; shareCard?: unknown; shareVideo?: unknown } | null>("get_boks_author_page", { p_handle: bare }, options),
  ]);
  const author = sharedAuthorFromAnswer(bare, answer);
  if (!author) return null;
  // The name the author set for their page outranks a byline guessed from their boks.
  if (page && typeof page.name === "string" && page.name.trim()) author.name = page.name.trim();
  author.photoVersion = page && typeof page.photoVersion === "number" ? page.photoVersion : null;
  author.shareCard = page && typeof page.shareCard === "string" && /^\/l\/[A-Za-z0-9_-]{22,64}\/f\/[a-z0-9-]+-share\.(jpg|webp|gif)$/.test(page.shareCard)
    ? page.shareCard
    : null;
  author.shareVideo = page && typeof page.shareVideo === "string" && /^\/l\/[A-Za-z0-9_-]{22,64}\/f\/[a-z0-9-]+-share\.mp4$/.test(page.shareVideo)
    ? page.shareVideo
    : null;
  return author;
}

/**
 * Where an author's earlier address leads now: their current handle, or null.
 * A link shared before a rename keeps reaching the page.
 */
export async function loadMovedAuthorHandle(handle: string, options: RpcOptions = {}): Promise<string | null> {
  const bare = bareHandle(handle);
  if (!bare) return null;
  const moved = await publicRpc<string | null>("get_boks_author_moved", { p_handle: bare }, options);
  return typeof moved === "string" && bareHandle(moved) === moved.toLowerCase() ? moved : null;
}

/** The photo an author set, as JPEG bytes and its version; null without one. */
export async function loadAuthorPhoto(handle: string, options: RpcOptions = {}): Promise<{ version: number; jpeg: Uint8Array<ArrayBuffer> } | null> {
  const bare = bareHandle(handle);
  if (!bare) return null;
  const answer = await publicRpc<{ version?: unknown; jpeg?: unknown } | null>("get_boks_author_photo", { p_handle: bare }, { timeoutMs: 4000, ...options });
  if (!answer || typeof answer.jpeg !== "string" || typeof answer.version !== "number") return null;
  const binary = atob(answer.jpeg.replace(/\s+/g, ""));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { version: answer.version, jpeg: bytes };
}
