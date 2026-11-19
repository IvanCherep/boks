/**
 * Covers drawn for a bok its author publishes (`docs/author-publishing.md`).
 *
 * The Series recorder's pipeline, read rather than copied
 * (`lib/boks/series-recorder/art.ts`): YandexGPT reads the piece and writes
 * two different scenes for one cover, Alice AI Image draws each in the house
 * look. A cover carries the whole piece, not a fragment, so the scenes are
 * asked of its opening - enough for the mood, small enough for the filter.
 */
import { ArtServiceError, artPrompt, drawPicture, quietScenes, readScenes, type YandexKeys } from "@/lib/boks/series-recorder/art";

export const coverSystem = [
  "Ты художник-постановщик обложек для коротких литературных произведений.",
  "Прочитай начало произведения и придумай две разные тихие кинематографичные сцены для вертикальной обложки: конкретное место, предметы, свет, погода.",
  "Не рисуй метафоры буквально, ищи зримый образ настроения текста. Две сцены должны отличаться местом или планом: одна шире, другая ближе.",
  "Люди только издалека или со спины, без лиц крупным планом. Никаких надписей, букв и текста в кадре.",
  "Каждая сцена - одно короткое предложение, не длиннее 150 символов: место, один-два предмета, свет.",
].join(" ");

/** The opening the scenes are asked of: whole lines, at most this many characters. */
export const coverExcerptLimit = 1500;

export function coverExcerpt(text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length > coverExcerptLimit && kept.length) break;
    kept.push(line.slice(0, coverExcerptLimit));
    length += line.length + 3;
  }
  return kept.join(" / ");
}

export function coverRequest(title: string, text: string) {
  return [
    title ? `Название: ${title}` : "",
    `Начало произведения: ${coverExcerpt(text)}`,
    "",
    "Ответь ровно двумя строками в формате «1. описание сцены» и «2. описание сцены». Больше ничего не пиши.",
  ].filter((line, index) => line || index > 0).join("\n");
}

async function askCoverScenes(keys: YandexKeys, title: string, text: string): Promise<(string | null)[]> {
  let response: Response;
  try {
    response = await fetch("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
      method: "POST",
      headers: { Authorization: `Api-Key ${keys.apiKey}`, "x-folder-id": keys.folder, "Content-Type": "application/json" },
      body: JSON.stringify({
        modelUri: `gpt://${keys.folder}/yandexgpt/latest`,
        completionOptions: { temperature: 0.6, maxTokens: "400" },
        messages: [
          { role: "system", text: coverSystem },
          { role: "user", text: coverRequest(title, text) },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new ArtServiceError("unavailable", `No answer from YandexGPT: ${error instanceof Error ? error.message : error}`);
  }
  if (!response.ok) throw new ArtServiceError("unavailable", `YandexGPT answered ${response.status}.`);
  const body = (await response.json()) as { result?: { alternatives?: { status?: string; message?: { text?: string } }[] } };
  const answer = body.result?.alternatives?.[0];
  if (!answer || answer.status === "ALTERNATIVE_STATUS_CONTENT_FILTER") return [null, null];
  return readScenes(answer.message?.text ?? "", 2);
}

/** Two scenes for one piece; where the model would write none, a quiet one of the house's. */
export async function writeCoverScenes(keys: YandexKeys, title: string, text: string): Promise<string[]> {
  const scenes = await askCoverScenes(keys, title, text);
  return scenes.map((scene, index) => scene ?? quietScenes[index % quietScenes.length]);
}

/** Both pictures, as JPEG bytes, with the prompt each was drawn from. */
export async function drawCovers(keys: YandexKeys, title: string, text: string, count: number) {
  const scenes = (await writeCoverScenes(keys, title, text)).slice(0, count);
  return Promise.all(scenes.map(async (scene) => {
    const prompt = artPrompt(scene);
    return { prompt, jpeg: await drawPicture(keys, prompt) };
  }));
}
