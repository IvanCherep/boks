/**
 * Pictures for a Series, drawn by Yandex (`docs/series-recorder.md`).
 *
 * YandexGPT reads the poem and writes one scene a picture from the lines that
 * picture will carry; Alice AI Image (`aliceai-image-art-3.0`) draws each
 * scene in the series' look - the one tried on «азбука веры» on 2026-11-15
 * and kept: quiet cinematic photographs in cool morning light. Only the
 * worker calls this; the key never reaches the app or the browser.
 */

/**
 * How every picture looks, whatever it shows: the look of Алексей Прохоров's
 * Series («азбука веры», «коса», «память шва»), which suits nearly any verse -
 * airy milky mist, soft diffused morning light, a pastel blue-grey with a
 * gentle peach glow of dawn, low contrast, a painterly softness, a simple
 * composition with a great deal of empty space. It is the house's, appended
 * to every scene on the server; an author never sees or edits it. Kept short:
 * a prompt is at most 500 characters.
 */
export const artStyle =
  "Тихая кинематографичная фотография в мягкой живописной манере: воздушный молочный туман, рассеянный утренний свет, пастельная сине-серая палитра с нежным персиковым свечением рассвета, низкий контраст, лёгкое зерно, простая композиция с большим пустым пространством, без текста и букв";

export const promptLimit = 500;
const sceneLimit = promptLimit - artStyle.length - 2;

/** One prompt for the image model: the scene, cut to fit, then the look. */
export function artPrompt(scene: string) {
  const clean = scene.replace(/\s+/g, " ").replace(/[«»"]/g, "").trim().replace(/[.\s]+$/, "");
  const cut = clean.length > sceneLimit ? `${clean.slice(0, sceneLimit - 1).replace(/[\s,;:]+\S*$/, "")}` : clean;
  return `${cut}. ${artStyle}`;
}

export const scenesSystem = [
  "Ты художник-постановщик поэтических видео.",
  "Для каждого фрагмента стихотворения придумай одну тихую кинематографичную сцену для вертикальной фотографии: конкретное место, предметы, свет, погода.",
  "Не рисуй метафоры буквально, ищи зримый образ настроения строк.",
  "Люди только издалека или со спины, без лиц крупным планом. Никаких надписей, букв и текста в кадре.",
  "Сцены одного стихотворения - одна серия в одной местности: природа, вода, старый дом, поле или берег.",
  "Всегда раннее утро, туман или дымка, рассеянный свет. Никаких закатов, ночи, города, кафе, ярких красок, толпы.",
  "Каждая сцена - одно короткое предложение, не длиннее 150 символов: место, один-два предмета, свет.",
].join(" ");

/**
 * The fragments alone, without the title and the whole poem: YandexGPT's
 * content filter refused «азбука веры» whole (2026-11-15) but wrote every
 * fragment of it, asked as fragments.
 */
export function scenesRequest(fragments: string[][]) {
  return [
    "Фрагменты одного стихотворения, по одной картинке на каждый:",
    ...fragments.map((lines, index) => `${index + 1}. ${lines.join(" / ")}`),
    "",
    `Ответь ровно ${fragments.length} строками, по строке на фрагмент, в формате «1. описание сцены». Больше ничего не пиши.`,
  ].join("\n");
}

/** The model's numbered list: a scene for each number it answered, null where it did not. */
export function readScenes(reply: string, count: number): (string | null)[] {
  const found = new Map<number, string>();
  for (const line of reply.split("\n")) {
    const match = /^\s*\**\s*(\d+)\s*[.)]\**\s*(.+)$/.exec(line);
    if (match) found.set(Number(match[1]), match[2].replace(/^[«"]|[»"]$/g, "").trim());
  }
  return Array.from({ length: count }, (_, index) => found.get(index + 1) || null);
}

/**
 * When the model will write nothing for some lines, a scene that says
 * nothing about them but still belongs in the series - never the lines
 * themselves, which drew the same misty dawn for every picture.
 */
export const quietScenes = [
  "Пустая тихая комната, луч света из окна на деревянный пол",
  "Гладь озера в утреннем тумане, далёкий берег",
  "Поле с высокой травой под огромным пустым небом",
  "Старая деревянная скамья у воды на рассвете",
];

export type YandexKeys = { apiKey: string; folder: string };

/**
 * `unavailable`: out of quota, billing stopped, or not answering - none of it
 * the author's to fix, and uploading their own pictures still works.
 * `refused`: the model would not draw this scene.
 */
export class ArtServiceError extends Error {
  constructor(readonly code: "unavailable" | "refused", message: string) {
    super(message);
  }
}

/** A call that may not answer at all: a network failure or a timeout is the service being unavailable too. */
async function call(url: string, init: RequestInit) {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw new ArtServiceError("unavailable", `No answer from ${new URL(url).host}: ${error instanceof Error ? error.message : error}`);
  }
}

async function askScenes(keys: YandexKeys, fragments: string[][]): Promise<(string | null)[]> {
  const response = await call("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
    method: "POST",
    headers: { Authorization: `Api-Key ${keys.apiKey}`, "x-folder-id": keys.folder, "Content-Type": "application/json" },
    body: JSON.stringify({
      modelUri: `gpt://${keys.folder}/yandexgpt/latest`,
      completionOptions: { temperature: 0.5, maxTokens: "800" },
      messages: [
        { role: "system", text: scenesSystem },
        { role: "user", text: scenesRequest(fragments) },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  // 402, 403 and 429 are billing and quota there; any of them stops the drawing until the team looks.
  if (!response.ok) throw new ArtServiceError("unavailable", `YandexGPT answered ${response.status}.`);
  const body = (await response.json()) as { result?: { alternatives?: { status?: string; message?: { text?: string } }[] } };
  const answer = body.result?.alternatives?.[0];
  // The filter answers with an apology, not with scenes.
  if (!answer || answer.status === "ALTERNATIVE_STATUS_CONTENT_FILTER") return fragments.map(() => null);
  return readScenes(answer.message?.text ?? "", fragments.length);
}

/**
 * Scenes for the fragments, from YandexGPT: all together first, so they read
 * as one series; any it would not write, one fragment at a time; any still
 * missing, a quiet scene of the series' own.
 */
export async function writeScenes(keys: YandexKeys, fragments: string[][]): Promise<string[]> {
  const scenes = await askScenes(keys, fragments);
  await Promise.all(scenes.map(async (scene, index) => {
    if (scene) return;
    scenes[index] = (await askScenes(keys, [fragments[index]]))[0];
  }));
  return scenes.map((scene, index) => scene ?? quietScenes[index % quietScenes.length]);
}

/** One picture, as JPEG bytes. */
export async function drawPicture(keys: YandexKeys, prompt: string): Promise<Uint8Array> {
  const response = await call("https://ai.api.cloud.yandex.net/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Api-Key ${keys.apiKey}`, "OpenAI-Project": keys.folder, "Content-Type": "application/json" },
    // The tallest frame the model takes; it answers 768x1344, which the build brings to 1080x1920.
    body: JSON.stringify({ model: `art://${keys.folder}/aliceai-image-art-3.0`, prompt, size: "1024x1792" }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await response.json().catch(() => ({}))) as { data?: { b64_json?: string }[] };
  // A prompt the model will not draw comes back as a client error, not as a picture.
  if (response.status === 400 || response.status === 422) throw new ArtServiceError("refused", `The image model refused the scene (${response.status}).`);
  if (!response.ok || !body.data?.[0]?.b64_json) throw new ArtServiceError("unavailable", `The image model answered ${response.status}.`);
  return Uint8Array.from(Buffer.from(body.data[0].b64_json, "base64"));
}
