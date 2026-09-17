#!/usr/bin/env -S npx tsx
/**
 * Downloads candidate pages from Russian Wikisource, once, and caches them.
 *
 * Why Wikisource and not Gutenberg: Gutenberg's whole catalogue holds five
 * Russian-language texts, two of which are literature. Wikisource holds
 * thousands, with per-author categories, a machine-readable publication year
 * and its own `PD-old-70` licence marker.
 *
 * Separate from the build step for the same reason the Gutenberg pair is
 * separate: the download is slow and polite, the conversion is fast and got
 * fixed eleven times. Re-running the build must not re-hit the API.
 *
 *   npx tsx scripts/fetch-wikisource.mts                # every author in the list
 *   npx tsx scripts/fetch-wikisource.mts Чехов Есенин   # only matching authors
 *
 * Politeness: one request at a time, 50 pages per request, a real user agent,
 * `maxlag` so the servers can push back, and a retry that honours
 * `Retry-After`. The first version of this fired requests in a loop with a
 * 150ms gap and was rate-limited after the fifth - which looked exactly like
 * "these categories do not exist", and nearly went into the source list as
 * fact.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
// The same ranking the converter uses, imported rather than copied: the two
// have to agree on which printing of a work to take, and a second copy of the
// rule had already drifted from the tested one by the time it was noticed.
import { readRedactionHub } from "../lib/boks/import/wikitext";

const api = "https://ru.wikisource.org/w/api.php";
const agent = "boks-corpus-builder/1.0 (one-off public-domain corpus for a reading app)";
const cacheDir = path.resolve(import.meta.dirname, "wikisource");
const sourcesFile = path.resolve(import.meta.dirname, "wikisource-sources.json");

/** How many candidates to consider per piece we want to end up with. */
const candidateOversample = 4;

let lastRequest = 0;

async function pace(ms = 900) {
  const wait = lastRequest + ms - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequest = Date.now();
}

/**
 * Every call goes by POST.
 *
 * Fifty Cyrillic page titles percent-encode to six characters each, so a
 * `titles=` query string for one batch runs past 15,000 characters and the
 * server answers 414 rather than doing the work. MediaWiki accepts read
 * queries over POST for exactly this reason.
 */
/**
 * The shapes this script reads out of the API. Narrow on purpose: everything
 * else in a MediaWiki response is something this corpus does not use.
 */
type ApiResponse = {
  error?: { code: string; info: string };
  continue?: { cmcontinue?: string };
  query?: {
    categorymembers?: { title: string }[];
    pages?: {
      title: string;
      missing?: boolean;
      revisions?: { slots?: { main?: { content?: string } } }[];
      categories?: { title: string }[];
    }[];
  };
};

type CachedPage = {
  title: string;
  missing: boolean;
  wikitext: string;
  categories: string[];
};

type Source = {
  author: string;
  categories: string[];
  kind: "verse" | "prose";
  take: number;
};

async function call(params: Record<string, string>, attempt = 0): Promise<ApiResponse> {
  await pace();
  const response = await fetch(api, {
    method: "POST",
    headers: { "User-Agent": agent, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...params }),
  });

  if (response.status === 429 || response.status === 503) {
    if (attempt > 5) throw new Error(`${response.status} after ${attempt} retries`);
    const after = Number(response.headers.get("retry-after") ?? 0) || 2 ** attempt * 2;
    console.log(`  … ${response.status}, waiting ${after}s`);
    await new Promise((resolve) => setTimeout(resolve, after * 1000));
    return call(params, attempt + 1);
  }
  if (!response.ok) throw new Error(`${response.status} from the API`);

  const body = (await response.json()) as ApiResponse;
  if (body.error?.code === "maxlag") {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return call(params, attempt + 1);
  }
  if (body.error) throw new Error(`${body.error.code}: ${body.error.info}`);
  return body;
}

async function categoryMembers(category: string) {
  const titles: string[] = [];
  let cont: string | undefined;
  do {
    const res = await call({
      action: "query",
      list: "categorymembers",
      cmtitle: `Категория:${category}`,
      cmlimit: "500",
      cmnamespace: "0",
      ...(cont ? { cmcontinue: cont } : {}),
    });
    titles.push(...(res.query?.categorymembers ?? []).map((member) => member.title));
    cont = res.continue?.cmcontinue;
  } while (cont);
  return titles;
}

/**
 * Titles that are not the work.
 *
 * `/ДО` is pre-reform orthography, `/Версия N` and `/Вариант` are alternate
 * printings reached through the base page, and the rest are reference works
 * and manuscript scraps that share an author's category with their poems.
 */
const skipTitle: RegExp[] = [
  /\/(ДО|Версия|Вариант|Черновик|с ударениями)/u,
  /^(БСЭ1|ЭСБЕ|МЭСБЕ|НЭС|А8|РБС|ТСД|ЕЭБЕ|ПБЭ|ВЭ|Брокгауз)\//u,
  /^(Отрывок|Набросок|Фрагмент|Черновик|Конспект|План|Дневник|Записная книжка)/iu,
  /\((?:отрывок|набросок|черновик|фрагмент|неоконченное)\)/iu,
  /^Письм[оа]\b/iu,
  /^Список\b/iu,
  /:/u,
];

function sanitise(title: string) {
  // A title can be 200 characters of Cyrillic with slashes and quotes in it.
  // The hash keeps the filename short and stable; the title is inside the file.
  return `${createHash("sha1").update(title).digest("hex").slice(0, 16)}.json`;
}

/**
 * Deterministic shuffle.
 *
 * Which of Pushkin's 933 pages get considered has to be the same on every run,
 * or the corpus changes shape each time it is rebuilt and nothing about it can
 * be checked twice. Alphabetical order would have been reproducible too, and
 * would have taken every poem beginning with А.
 */
function shuffled(items: readonly string[], seed: string) {
  let state = [...seed].reduce((hash, char) => (hash * 31 + (char.codePointAt(0) ?? 0)) % 2147483647, 7);
  const next = () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
}

/** Fetches wikitext and categories for up to 50 titles in one request. */
async function fetchPages(titles: readonly string[]): Promise<CachedPage[]> {
  const res = await call({
    action: "query",
    prop: "revisions|categories",
    rvprop: "content",
    rvslots: "main",
    cllimit: "500",
    titles: titles.join("|"),
  });
  return (res.query?.pages ?? []).map((page) => ({
    title: page.title,
    missing: Boolean(page.missing),
    wikitext: page.revisions?.[0]?.slots?.main?.content ?? "",
    categories: (page.categories ?? []).map((category) => category.title.replace(/^Категория:/u, "")),
  }));
}

async function cachedTitles() {
  try {
    const files = await readdir(cacheDir);
    const titles = new Set<string>();
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const page = JSON.parse(await readFile(path.join(cacheDir, file), "utf8"));
      titles.add(page.title);
    }
    return titles;
  } catch {
    return new Set();
  }
}

async function savePage(page: CachedPage, extra: Record<string, unknown>) {
  await writeFile(
    path.join(cacheDir, sanitise(page.title)),
    JSON.stringify({ ...page, ...extra }, null, 1) + "\n",
    "utf8"
  );
}

await mkdir(cacheDir, { recursive: true });

const sources: Source[] = JSON.parse(await readFile(sourcesFile, "utf8"));
const only = process.argv.slice(2);
const selected = only.length
  ? sources.filter((source) => only.some((name) => source.author.includes(name)))
  : sources;

const have = await cachedTitles();
console.log(`${have.size} pages already cached, ${selected.length} authors to consider\n`);

for (const source of selected) {
  const candidates: string[] = [];
  for (const category of source.categories) {
    const members = await categoryMembers(category);
    candidates.push(...members.filter((title) => !skipTitle.some((pattern) => pattern.test(title))));
  }
  const unique = [...new Set(candidates)];
  // Oversample, because the converter rejects a lot on purpose: hubs, pieces
  // over fifteen minutes, pre-reform printings, apparatus.
  const wanted = shuffled(unique, source.author).slice(0, source.take * candidateOversample);
  const missing = wanted.filter((title) => !have.has(title));

  console.log(
    `${source.author}: ${unique.length} candidates, taking ${wanted.length}, ${missing.length} to download`
  );

  const hubs: CachedPage[] = [];
  for (let index = 0; index < missing.length; index += 50) {
    const batch = missing.slice(index, index + 50);
    const pages = await fetchPages(batch);
    for (const page of pages) {
      await savePage(page, { author: source.author, wantedKind: source.kind });
      have.add(page.title);
      // An edition list points at the subpages that hold the text. Collected
      // here and fetched in a second pass so one bad page cannot lose a batch.
      if (readRedactionHub(page.wikitext)) hubs.push(page);
    }
    process.stdout.write(`  … ${Math.min(index + 50, missing.length)}/${missing.length}\r`);
  }

  // Second pass: the chosen printing of each work that lives on a subpage.
  const variantTitles: string[] = [];
  for (const hub of hubs) {
    const best = readRedactionHub(hub.wikitext)?.variants[0];
    if (best) variantTitles.push(`${hub.title}/${best}`);
  }
  const newVariants = variantTitles.filter((title) => !have.has(title));
  if (newVariants.length) {
    console.log(`  ${hubs.length} edition lists -> ${newVariants.length} printings to download`);
    for (let index = 0; index < newVariants.length; index += 50) {
      const pages = await fetchPages(newVariants.slice(index, index + 50));
      for (const page of pages) {
        await savePage(page, { author: source.author, wantedKind: source.kind, viaHub: true });
        have.add(page.title);
      }
    }
  }
}

console.log(`\ncache now holds ${have.size} pages in ${cacheDir}`);
