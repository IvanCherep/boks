/**
 * The language model as the fragment pipeline sees it: a task in, a JSON
 * object out. Each stage that asks the model (`scenes.ts`, `refine.ts`,
 * `judge.ts`) builds an `LlmTask`; who answers it is the caller's business.
 *
 * Two providers are wired: Yandex AI Studio (Alice AI LLM, YandexGPT) through
 * its OpenAI-compatible chat endpoint, and Anthropic's Messages API. Both are
 * asked for structured output against the task's JSON schema, so no stage
 * parses prose. This file only builds request bodies and reads response
 * bodies; the fetch happens in the Worker (`app/api/admin/fragments/llm`) or
 * the CLI (`scripts/cut-fragments.mts`), which hold the keys.
 */

export type JsonSchema = Record<string, unknown>;

export type LlmTask = {
  /** Which stage asks: shown in progress and usage, and part of the cache key. */
  stage: "scenes" | "refine" | "judge" | "tournament";
  system: string;
  user: string;
  schema: JsonSchema;
  maxTokens: number;
};

export type LlmUsage = { promptTokens: number; completionTokens: number };

export type LlmReply = { json: unknown; usage: LlmUsage | null };

/** Answers a task, or throws. A null `json` means the model answered with nothing usable. */
export type LlmCall = (task: LlmTask) => Promise<LlmReply>;

export type LlmProvider = "yandex" | "anthropic";

/** Models the Worker will forward to. */
export const yandexModels = ["aliceai-llm", "yandexgpt", "yandexgpt-lite", "gpt-oss-120b"] as const;
export type YandexModel = (typeof yandexModels)[number];
export const defaultYandexModel: YandexModel = "aliceai-llm";

/**
 * Which model answers which stage, by default. Alice AI reads Russian prose
 * well enough to mark scenes, move edges and fill in the checklist, but in
 * pairwise comparison it chose the second fragment shown every time, in both
 * orders, so its tournament is all draws. gpt-oss-120b, asked the same pairs,
 * agreed with itself across the two orders on most of them. See
 * docs/fragment-cutter.md, "Choice of models".
 */
export const defaultStageModels: Record<LlmTask["stage"], YandexModel> = {
  scenes: "aliceai-llm",
  refine: "aliceai-llm",
  judge: "aliceai-llm",
  tournament: "gpt-oss-120b",
};

/** gpt-oss reasons before it answers, and the reasoning counts against max_tokens. */
const reasoningModels = new Set<YandexModel>(["gpt-oss-120b"]);
const reasoningAllowance = 3000;
export const defaultAnthropicModel = "claude-haiku-5-5";

export const yandexChatUrl = "https://llm.api.cloud.yandex.net/v1/chat/completions";

/** Upper bounds the Worker enforces on what an admin page may send through it. */
export const taskLimits = { systemChars: 8_000, userChars: 60_000, maxTokens: 4_000 };

/**
 * Yandex AI Studio allows five generation requests in flight per folder;
 * the sixth is refused with 429. One run keeps under that on its own.
 */
export const yandexConcurrency = 4;

export function isYandexModel(value: unknown): value is YandexModel {
  return typeof value === "string" && (yandexModels as readonly string[]).includes(value);
}

/** The OpenAI-compatible body Yandex AI Studio accepts. Temperature 0: the same text gets the same answer. */
export function yandexChatBody(task: LlmTask, folderId: string, model: YandexModel = defaultYandexModel) {
  return {
    model: `gpt://${folderId}/${model}/latest`,
    temperature: 0,
    max_tokens: task.maxTokens + (reasoningModels.has(model) ? reasoningAllowance : 0),
    response_format: { type: "json_schema", json_schema: { name: task.stage, schema: task.schema } },
    messages: [
      { role: "system", content: task.system },
      { role: "user", content: task.user },
    ],
  };
}

/** The JSON object from a chat-completions body, or null on a cut-off, a refusal or anything but JSON. */
export function readYandexChat(response: unknown): LlmReply {
  const body = response as {
    choices?: { finish_reason?: string; message?: { content?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const usage = body?.usage
    ? { promptTokens: Number(body.usage.prompt_tokens ?? 0), completionTokens: Number(body.usage.completion_tokens ?? 0) }
    : null;
  const choice = body?.choices?.[0];
  if (!choice || choice.finish_reason !== "stop" || !choice.message?.content) return { json: null, usage };
  return { json: parseJsonObject(choice.message.content), usage };
}

export function anthropicBody(task: LlmTask, model = defaultAnthropicModel) {
  return {
    model,
    max_tokens: task.maxTokens + 1024,
    system: task.system,
    output_config: { effort: "low", format: { type: "json_schema", schema: task.schema } },
    messages: [{ role: "user", content: task.user }],
  };
}

export function readAnthropic(response: unknown): LlmReply {
  const message = response as {
    stop_reason?: string;
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const usage = message?.usage
    ? { promptTokens: Number(message.usage.input_tokens ?? 0), completionTokens: Number(message.usage.output_tokens ?? 0) }
    : null;
  if (message?.stop_reason !== "end_turn") return { json: null, usage };
  const text = message.content?.find((block) => block.type === "text")?.text;
  return { json: text ? parseJsonObject(text) : null, usage };
}

/** A JSON object, tolerating a code fence around it; null for anything else. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const value = JSON.parse(trimmed) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Retries on what a retry can fix - rate limits, timeouts, a 5xx - with
 * exponential backoff and jitter. An error carrying `status` 400..499 other
 * than 408 and 429 is the request's fault and is thrown at once.
 */
export function withRetries(call: LlmCall, { attempts = 6, baseMs = 2000, sleep = defaultSleep } = {}): LlmCall {
  return async (task) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await call(task);
      } catch (error) {
        lastError = error;
        if (error instanceof Error && error.name === "AbortError") throw error;
        const status = (error as { status?: number }).status;
        if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) throw error;
        if (attempt + 1 < attempts) await sleep(baseMs * 2 ** attempt * (0.75 + Math.random() / 2));
      }
    }
    throw lastError;
  };
}

/** At most `limit` calls in flight, however many stages ask at once. */
export function withConcurrency(call: LlmCall, limit: number): LlmCall {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await call(task);
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

/** One answer per identical task: a re-run after a crash, or two stages asking the same thing, costs nothing. */
export function withCache(call: LlmCall, cache = new Map<string, Promise<LlmReply>>()): LlmCall {
  return (task) => {
    const key = `${task.stage}\u0000${task.system}\u0000${task.user}`;
    let reply = cache.get(key);
    if (!reply) {
      reply = call(task);
      // A failure is not remembered: the next ask tries again.
      reply.catch(() => cache.delete(key));
      cache.set(key, reply);
    }
    return reply;
  };
}

function defaultSleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run `work` over `items` with at most `limit` in flight, keeping order. */
export async function mapLimited<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** Integer in [min, max], or null. Models sometimes answer "4" for 4. */
export function intIn(value: unknown, min: number, max: number) {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return null;
  const rounded = Math.round(number);
  return rounded >= min && rounded <= max ? rounded : null;
}

/** A short string, trimmed and capped, or "". */
export function shortText(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
