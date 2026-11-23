/**
 * Materials an author posts about their own work (`docs/story-kit.md`):
 * vertical pictures for stories and posts in the boks look - the velvet
 * curtain, the yellow ribbon with the word boks and its red knob - drawn in
 * the author's browser from what their page already shows. Nothing is drawn
 * on the server: a frame of a Series is WebP, which the image renderer there
 * cannot read, and a picture made here can go straight to the phone's share
 * sheet (Instagram, VK, Telegram stories) without a round trip.
 *
 * Every word on a card is the author's own: a title, a byline, lines of the
 * text (for a Series, only lines its recording reads), and the page's address.
 */
import { wrapPosterText } from "@/components/boks/share-card-export";

export type KitFormat = "story" | "post";

/** Stories (Instagram, VK, Telegram) are 9:16; a feed post is 4:5. */
export const kitSize: Record<KitFormat, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  post: { width: 1080, height: 1350 },
};

type Common = {
  format: KitFormat;
  /** The page's address as printed, `tryboks.com/@name`. */
  link: string;
  /** The small line that invites: "Read on boks". */
  invite: string;
};

export type KitCard = Common &
  (
    | {
        /** The cover behind the curtain, the title below: a poster. */
        style: "poster";
        image: string | null;
        focus?: string;
        title: string;
        byline: string | null;
        /** A word above the title ("boks series"), or nothing. */
        kicker?: string | null;
      }
    | {
        /** A picture of the Series with the words it carries. */
        style: "frame";
        image: string;
        focus?: string;
        lines: string[];
        title: string;
        byline: string | null;
      }
    | {
        /** Lines of the text, set on paper. */
        style: "lines";
        image: string | null;
        focus?: string;
        lines: string[];
        title: string;
        byline: string | null;
      }
    | {
        /** The author's page: their photo, name and covers. */
        style: "author";
        photo: string | null;
        name: string;
        covers: string[];
        /** "6 texts · 4 Series", or nothing. */
        note?: string | null;
      }
  );

const ink = "#f7f6ef";
const ground = "#1c242a";
const paper = "#f3ede2";
const paperInk = "#1f2b31";

const fontFiles = [
  ["KitTitle", "/share/fonts/boks-preview-serif-450.ttf"],
  ["KitSans", "/share/fonts/noto-sans.ttf"],
  ["KitItalic", "/share/fonts/source-serif-4-italic.ttf"],
] as const;

const stage = {
  velvet: "/share/curtain/stage/velvet.webp",
  ribbonBody: "/share/curtain/stage/ribbon-body.webp",
  ribbonEnd: "/share/curtain/stage/ribbon-end.webp",
  puck: "/share/curtain/stage/puck.webp",
  word: "/share/curtain/stage/boks-ink.webp",
} as const;

let fontsReady: Promise<void> | undefined;

function loadFonts() {
  fontsReady ??= Promise.all(
    fontFiles.map(async ([family, url]) => {
      const face = new FontFace(family, `url(${url})`);
      document.fonts.add(await face.load());
    })
  )
    .then(() => undefined)
    .catch((error) => {
      fontsReady = undefined;
      throw error;
    });
  return fontsReady;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();

/** An image of this origin, or null if it does not load: a card is drawn without it. */
export function loadKitImage(src: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  let pending = images.get(src);
  if (!pending) {
    pending = new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = src;
    });
    images.set(src, pending);
    // A failure is not remembered: the next card tries again.
    void pending.then((image) => { if (!image) images.delete(src); });
  }
  return pending;
}

type Stage = { velvet: HTMLImageElement | null; ribbonBody: HTMLImageElement | null; ribbonEnd: HTMLImageElement | null; puck: HTMLImageElement | null; word: HTMLImageElement | null };

async function loadStage(): Promise<Stage> {
  const [velvet, ribbonBody, ribbonEnd, puck, word] = await Promise.all([stage.velvet, stage.ribbonBody, stage.ribbonEnd, stage.puck, stage.word].map(loadKitImage));
  return { velvet, ribbonBody, ribbonEnd, puck, word };
}

type Ctx = CanvasRenderingContext2D;

function focusOf(focus: string | undefined) {
  const [x, y] = (focus ?? "50% 50%").split(/\s+/).map((part) => {
    const value = Number.parseFloat(part);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value / 100)) : 0.5;
  });
  return { x: x ?? 0.5, y: y ?? 0.5 };
}

/** Draws an image to cover a box, moved within the room it has by `focus` (CSS object-position). */
function cover(context: Ctx, image: CanvasImageSource & { width: number; height: number }, x: number, y: number, width: number, height: number, focus?: string) {
  const scale = Math.max(width / image.width, height / image.height);
  const drawnWidth = image.width * scale;
  const drawnHeight = image.height * scale;
  const at = focusOf(focus);
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.drawImage(image, x - (drawnWidth - width) * at.x, y - (drawnHeight - height) * at.y, drawnWidth, drawnHeight);
  context.restore();
}

function fill(context: Ctx, style: string | CanvasGradient, x: number, y: number, width: number, height: number) {
  context.fillStyle = style;
  context.fillRect(x, y, width, height);
}

function vertical(context: Ctx, y0: number, y1: number, stops: [number, string][]) {
  const gradient = context.createLinearGradient(0, y0, 0, y1);
  for (const [at, color] of stops) gradient.addColorStop(at, color);
  return gradient;
}

/**
 * One side of the curtain, drawn open: wide at the top, gathered where the
 * ribbon ties it, falling loose below. The velvet's folds run down, as on the
 * stage; the inner edge is shaded and casts a shadow on the picture.
 */
function drape(context: Ctx, velvet: HTMLImageElement | null, side: "left" | "right", width: number, height: number, top: number, tieY: number, reach: { top: number; tie: number; bottom: number }) {
  const mirror = side === "right";
  context.save();
  if (mirror) {
    context.translate(width, 0);
    context.scale(-1, 1);
  }
  const path = new Path2D();
  path.moveTo(0, top);
  path.lineTo(reach.top, top);
  path.bezierCurveTo(reach.top, top + (tieY - top) * 0.55, reach.tie + 26, tieY - (tieY - top) * 0.18, reach.tie, tieY);
  path.bezierCurveTo(reach.tie + 18, tieY + (height - tieY) * 0.3, reach.bottom, height - (height - tieY) * 0.35, reach.bottom + 14, height);
  path.lineTo(0, height);
  path.closePath();

  context.save();
  context.shadowColor = "rgba(0,0,0,.55)";
  context.shadowBlur = 38;
  context.shadowOffsetX = 10;
  context.fillStyle = "#5c0a0d";
  context.fill(path);
  context.restore();

  context.save();
  context.clip(path);
  if (velvet) {
    // The velvet's folds, pressed together: a gathered curtain has more of them.
    const drawnHeight = height - top;
    const drawnWidth = Math.max(reach.top, reach.bottom) * 1.6;
    context.drawImage(velvet, mirror ? velvet.width * 0.52 : 0, 0, velvet.width * 0.48, velvet.height, 0, top, drawnWidth, drawnHeight);
  }
  // Shade toward the inner edge, and a little light on the outer folds.
  const shade = context.createLinearGradient(0, 0, reach.top, 0);
  shade.addColorStop(0, "rgba(0,0,0,.35)");
  shade.addColorStop(0.55, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,.45)");
  context.fillStyle = shade;
  context.fillRect(0, top, reach.top + 40, height - top);
  context.restore();
  context.restore();
}

/** The pelmet across the top, its lower edge in shallow swags. */
function valance(context: Ctx, velvet: HTMLImageElement | null, width: number, depth: number) {
  const swags = 4;
  const sag = depth * 0.3;
  const path = new Path2D();
  path.moveTo(0, 0);
  path.lineTo(width, 0);
  path.lineTo(width, depth - sag);
  for (let index = swags - 1; index >= 0; index -= 1) {
    const x0 = (width / swags) * (index + 1);
    const x1 = (width / swags) * index;
    path.quadraticCurveTo((x0 + x1) / 2, depth + sag, x1, depth - sag);
  }
  path.closePath();
  context.save();
  context.shadowColor = "rgba(0,0,0,.6)";
  context.shadowBlur = 34;
  context.shadowOffsetY = 12;
  context.fillStyle = "#5c0a0d";
  context.fill(path);
  context.restore();
  context.save();
  context.clip(path);
  if (velvet) context.drawImage(velvet, 0, velvet.height * 0.05, velvet.width, velvet.height * 0.32, 0, 0, width, depth + sag);
  context.fillStyle = vertical(context, 0, depth + sag, [[0, "rgba(0,0,0,.25)"], [0.6, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,.35)"]]);
  context.fillRect(0, 0, width, depth + sag);
  context.restore();
}

/**
 * The yellow ribbon from the left edge with the word boks, ending in the red
 * knob: the same pieces as the link card's curtain (`public/share/curtain/stage/`).
 * `height` is the ribbon's; returns where it ends.
 */
function ribbon(context: Ctx, parts: Stage, y: number, length: number, height: number) {
  const top = y - height / 2;
  const endWidth = height; // the rounded end is as wide as the ribbon is high
  // The ribbon is put together first and casts one shadow, as one piece: two
  // pieces each with its own shadow leave a dark step where they meet.
  const strip = document.createElement("canvas");
  strip.width = Math.ceil(length);
  strip.height = Math.ceil(height);
  const piece = strip.getContext("2d")!;
  if (parts.ribbonBody) piece.drawImage(parts.ribbonBody, 0, 0, parts.ribbonBody.width, parts.ribbonBody.height, 0, 0, length - endWidth + 4, height);
  else {
    piece.fillStyle = "#ffd60a";
    piece.fillRect(0, 0, length - endWidth + 4, height);
  }
  if (parts.ribbonEnd) piece.drawImage(parts.ribbonEnd, 0, 0, parts.ribbonEnd.width, parts.ribbonEnd.height * (128 / 144), length - endWidth, 0, endWidth, height);
  else {
    piece.fillStyle = "#ffd60a";
    piece.beginPath();
    piece.arc(length - endWidth / 2, height / 2, height / 2, -Math.PI / 2, Math.PI / 2);
    piece.fill();
  }
  context.save();
  context.shadowColor = "rgba(0,0,0,.45)";
  context.shadowBlur = height * 0.35;
  context.shadowOffsetY = height * 0.12;
  context.drawImage(strip, 0, top, length, height);
  context.restore();
  if (parts.word) {
    const wordHeight = height * 0.74;
    const wordWidth = (parts.word.width / parts.word.height) * wordHeight;
    context.drawImage(parts.word, height * 0.62, top + (height - wordHeight) / 2 + height * 0.02, wordWidth, wordHeight);
  } else {
    context.fillStyle = paperInk;
    context.font = `italic ${Math.round(height * 0.6)}px KitTitle, Georgia, serif`;
    context.textBaseline = "middle";
    context.fillText("boks", height * 0.62, y);
    context.textBaseline = "alphabetic";
  }
  if (parts.puck) {
    const size = height * 0.82;
    context.drawImage(parts.puck, length - endWidth / 2 - size / 2 - height * 0.08, y - size / 2, size, size);
  }
  return length;
}

type Fitted = { size: number; lines: string[] };

/** The largest size from `max` to `min` at which the text wraps into at most `maxLines` lines of `width`. */
function fitText(context: Ctx, text: string, font: (size: number) => string, width: number, max: number, min: number, maxLines: number): Fitted {
  let size = max;
  let lines: string[] = [];
  for (; size >= min; size -= 2) {
    context.font = font(size);
    lines = wrapPosterText(context, text, width);
    if (lines.length <= maxLines) return { size, lines };
  }
  context.font = font(min);
  lines = wrapPosterText(context, text, width);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[\s,.;:—–-]+$/u, "")}…`;
  }
  return { size: min, lines };
}

/**
 * Verse keeps its lines: each wraps on its own, and the size comes down until
 * the whole passage fits the box.
 */
function fitVerse(context: Ctx, verse: string[], font: (size: number) => string, width: number, height: number, max: number, min: number, leading: number) {
  // A line of verse broken in two reads as two lines: first look for a size that keeps every line whole.
  for (let size = max; size >= Math.max(min, Math.round(max * 0.62)); size -= 2) {
    context.font = font(size);
    if (verse.every((line) => context.measureText(line).width <= width) && verse.length * size * leading <= height) return { size, lines: verse.map((line) => line.trim()) };
  }
  for (let size = max; size >= min; size -= 2) {
    context.font = font(size);
    const lines = verse.flatMap((line) => (line.trim() ? wrapPosterText(context, line, width) : [""]));
    if (lines.length * size * leading <= height) return { size, lines };
  }
  context.font = font(min);
  const lines = verse.flatMap((line) => (line.trim() ? wrapPosterText(context, line, width) : [""]));
  const fits = Math.max(1, Math.floor(height / (min * leading)));
  if (lines.length > fits) {
    const kept = lines.slice(0, fits);
    kept[fits - 1] = `${kept[fits - 1].replace(/[\s,.;:—–-]+$/u, "")}…`;
    return { size: min, lines: kept };
  }
  return { size: min, lines };
}

function shadowed(context: Ctx, blur: number, alpha = 0.7) {
  context.shadowColor = `rgba(8,6,5,${alpha})`;
  context.shadowBlur = blur;
  context.shadowOffsetY = Math.round(blur / 3);
}

function plain(context: Ctx) {
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
}

/** The invitation and the address at the foot of a card. */
function footer(context: Ctx, card: Common, width: number, y: number, color: string, muted: string, align: CanvasTextAlign = "left", left = 96) {
  context.textAlign = align;
  const x = align === "center" ? width / 2 : left;
  context.fillStyle = muted;
  context.font = "34px KitSans, Arial, sans-serif";
  context.fillText(card.invite, x, y);
  context.fillStyle = color;
  context.font = "44px KitSans, Arial, sans-serif";
  context.fillText(card.link, x, y + 58);
  context.textAlign = "left";
}

/**
 * The words at the foot of a card, laid out from the bottom up so a long
 * title grows upward instead of running into the address: the address, then
 * the byline, then the title, then the kicker. Returns where the block starts.
 */
type FootBlock = { top: number; draw: () => void };

function titleBlock(
  context: Ctx,
  options: { title: string; byline: string | null; kicker?: string | null; left: number; room: number; bottom: number; titleMax: number; titleMin: number; maxLines: number; bylineSize: number; color: string; bylineColor: string; shadow: boolean },
): FootBlock {
  const font = (size: number) => `${size}px KitTitle, Georgia, serif`;
  const title = fitText(context, options.title, font, options.room, options.titleMax, options.titleMin, options.maxLines);
  const leading = title.size * 1.04;
  const bylineBaseline = options.bottom;
  const lastTitle = options.byline ? bylineBaseline - options.bylineSize - 34 : bylineBaseline;
  const firstTitle = lastTitle - (title.lines.length - 1) * leading;
  const kickerBaseline = firstTitle - title.size * 0.82 - 30;
  const top = options.kicker ? kickerBaseline - 34 : firstTitle - title.size * 0.82;
  return {
    top,
    draw() {
      if (options.shadow) shadowed(context, 14);
      if (options.kicker) {
        context.fillStyle = "#ffd60a";
        context.font = "600 32px KitSans, Arial, sans-serif";
        context.fillText(options.kicker.toUpperCase().split("").join(" "), options.left, kickerBaseline);
      }
      context.fillStyle = options.color;
      context.font = font(title.size);
      title.lines.forEach((line, index) => context.fillText(line, options.left - 3, firstTitle + index * leading));
      if (options.byline) {
        context.fillStyle = options.bylineColor;
        const byline = fitText(context, options.byline, (size) => `${size}px KitSans, Arial, sans-serif`, options.room, options.bylineSize, 28, 1);
        context.font = `${byline.size}px KitSans, Arial, sans-serif`;
        context.fillText(byline.lines[0], options.left, bylineBaseline);
      }
      plain(context);
    },
  };
}

/** Where the invitation's baseline sits: above the reply bar and link sticker of a story. */
function footerY(story: boolean, height: number) {
  return story ? height - 290 : height - 140;
}

async function drawPoster(context: Ctx, card: Extract<KitCard, { style: "poster" }>, width: number, height: number, parts: Stage) {
  const story = card.format === "story";
  const art = await loadKitImage(card.image);
  fill(context, ground, 0, 0, width, height);
  if (art) cover(context, art, 0, 0, width, height, card.focus);
  else {
    // No cover: the title's first letter, large and quiet, as the reader shows it.
    context.fillStyle = "rgba(247,246,239,.08)";
    context.font = `${Math.round(height * 0.62)}px KitTitle, Georgia, serif`;
    context.fillText(card.title.trim().charAt(0), width * 0.2, height * 0.62);
  }
  const left = 128;
  const foot = footerY(story, height);
  const block = titleBlock(context, { title: card.title, byline: card.byline, kicker: card.kicker, left, room: width - left * 2, bottom: foot - 96, titleMax: story ? 112 : 92, titleMin: 56, maxLines: 3, bylineSize: 42, color: ink, bylineColor: ink, shadow: true });
  // The ribbon ties the curtain just above the title, never higher than the middle.
  const ribbonHeight = story ? 104 : 92;
  const tieY = Math.max(Math.round(height * (story ? 0.5 : 0.42)), Math.round(block.top - ribbonHeight / 2 - (story ? 56 : 40)));
  const shadeFrom = (tieY - height * 0.16) / height;
  fill(context, vertical(context, 0, height, [[0, "rgba(10,10,12,.35)"], [0.2, "rgba(10,10,12,0)"], [Math.max(0.21, shadeFrom), "rgba(10,10,12,0)"], [Math.min(0.97, shadeFrom + 0.2), "rgba(10,10,12,.72)"], [1, "rgba(10,10,12,.94)"]]), 0, 0, width, height);

  const reach = { top: story ? 190 : 170, tie: 62, bottom: story ? 120 : 110 };
  drape(context, parts.velvet, "left", width, height, 0, tieY, reach);
  drape(context, parts.velvet, "right", width, height, 0, tieY, reach);
  valance(context, parts.velvet, width, story ? 150 : 110);
  ribbon(context, parts, tieY, story ? 430 : 400, ribbonHeight);
  block.draw();
  footer(context, card, width, foot, ink, "rgba(247,246,239,.72)", "left", left);
}

async function drawFrame(context: Ctx, card: Extract<KitCard, { style: "frame" }>, width: number, height: number, parts: Stage) {
  const story = card.format === "story";
  const art = await loadKitImage(card.image);
  fill(context, ground, 0, 0, width, height);
  if (art) cover(context, art, 0, 0, width, height, card.focus);
  // Darker behind the words and at the foot, as the Series' own veil is.
  fill(context, vertical(context, 0, height, [[0, "rgba(10,10,12,.42)"], [0.16, "rgba(10,10,12,.08)"], [0.36, "rgba(10,10,12,.22)"], [0.62, "rgba(10,10,12,.42)"], [1, "rgba(10,10,12,.92)"]]), 0, 0, width, height);

  const ribbonY = story ? 250 : 130;
  ribbon(context, parts, ribbonY, story ? 360 : 320, story ? 92 : 80);

  const left = 96;
  const room = width - left * 2;
  const foot = footerY(story, height);
  const block = titleBlock(context, { title: card.title, byline: card.byline, left, room, bottom: foot - 92, titleMax: story ? 60 : 50, titleMin: 38, maxLines: 2, bylineSize: 36, color: ink, bylineColor: "rgba(247,246,239,.86)", shadow: true });

  const boxTop = ribbonY + (story ? 130 : 90);
  const boxHeight = block.top - (story ? 110 : 60) - boxTop;
  const leading = 1.24;
  const verse = fitVerse(context, card.lines, (size) => `${size}px KitItalic, Georgia, serif`, room, boxHeight, story ? 84 : 70, 40, leading);
  const blockHeight = verse.lines.length * verse.size * leading;
  const startY = boxTop + (boxHeight - blockHeight) / 2;
  // A soft shade under the words, so they hold on a busy picture, as the Series' veil does.
  const veil = Math.max(140, blockHeight * 0.9);
  fill(context, vertical(context, startY - veil * 0.5, startY + blockHeight + veil * 0.5, [[0, "rgba(10,10,12,0)"], [0.3, "rgba(10,10,12,.42)"], [0.7, "rgba(10,10,12,.42)"], [1, "rgba(10,10,12,0)"]]), 0, startY - veil * 0.5, width, blockHeight + veil);
  context.font = `${verse.size}px KitItalic, Georgia, serif`;
  context.fillStyle = ink;
  shadowed(context, 20, 0.9);
  verse.lines.forEach((line, index) => context.fillText(line, left, startY + verse.size * 0.9 + index * verse.size * leading));
  plain(context);
  block.draw();
  footer(context, card, width, foot, ink, "rgba(247,246,239,.72)", "left", left);
}

async function drawLines(context: Ctx, card: Extract<KitCard, { style: "lines" }>, width: number, height: number, parts: Stage) {
  const story = card.format === "story";
  const art = await loadKitImage(card.image);
  fill(context, paper, 0, 0, width, height);
  // A little velvet at the top: the stage this text plays on.
  const pelmet = story ? 210 : 120;
  valance(context, parts.velvet, width, pelmet);
  const ribbonY = pelmet + (story ? 110 : 80);
  ribbon(context, parts, ribbonY, story ? 360 : 320, story ? 92 : 80);
  const left = 110;
  let room = width - left * 2;
  if (art) {
    // The cover itself, small, as on a shelf, hanging from the pelmet.
    const coverWidth = story ? 220 : 150;
    const coverHeight = Math.round((coverWidth * 16) / 9);
    const x = width - 96 - coverWidth;
    const y = pelmet + (story ? 10 : 6);
    context.save();
    context.shadowColor = "rgba(20,14,10,.38)";
    context.shadowBlur = 30;
    context.shadowOffsetY = 14;
    fill(context, "#fff", x, y, coverWidth, coverHeight);
    context.restore();
    cover(context, art, x, y, coverWidth, coverHeight, card.focus);
    if (!story) room = width - left - 96 - coverWidth - 40;
  }

  const foot = footerY(story, height);
  const regionTop = story ? 760 : 440;
  const regionBottom = foot - 110;
  const leading = 1.28;
  const gap = story ? 80 : 56;
  const signature = gap + 52 + (card.byline ? 56 : 0);
  const verse = fitVerse(context, card.lines, (size) => `${size}px KitItalic, Georgia, serif`, story ? width - left * 2 : room, regionBottom - regionTop - signature, story ? 72 : 58, 34, leading);
  // The passage and its signature as one group, in the middle of the paper.
  const groupHeight = verse.lines.length * verse.size * leading + signature;
  const boxTop = regionTop + Math.max(0, (regionBottom - regionTop - groupHeight) / 2);
  // The opening guillemet, in the knob's red.
  context.fillStyle = "#c8242a";
  context.font = `${story ? 190 : 140}px KitTitle, Georgia, serif`;
  context.fillText("«", left - 12, boxTop - (story ? 40 : 30));
  context.font = `${verse.size}px KitItalic, Georgia, serif`;
  context.fillStyle = paperInk;
  verse.lines.forEach((line, index) => context.fillText(line, left, boxTop + verse.size * 0.9 + index * verse.size * leading));
  let y = boxTop + verse.lines.length * verse.size * leading + gap;
  fill(context, "#c8242a", left, y - 10, 64, 4);
  y += 52;
  if (card.byline) {
    context.fillStyle = paperInk;
    context.font = "40px KitSans, Arial, sans-serif";
    context.fillText(card.byline, left, y);
    y += 56;
  }
  context.fillStyle = "rgba(31,43,49,.72)";
  const title = fitText(context, `«${card.title}»`, (size) => `${size}px KitTitle, Georgia, serif`, width - left * 2, 42, 30, 1);
  context.font = `${title.size}px KitTitle, Georgia, serif`;
  context.fillText(title.lines[0], left, y);
  footer(context, card, width, foot, paperInk, "rgba(31,43,49,.6)", "left", left);
}

async function drawAuthor(context: Ctx, card: Extract<KitCard, { style: "author" }>, width: number, height: number, parts: Stage) {
  const story = card.format === "story";
  const [photo, ...covers] = await Promise.all([loadKitImage(card.photo), ...card.covers.slice(0, 3).map(loadKitImage)]);
  fill(context, "#3a0507", 0, 0, width, height);
  if (parts.velvet) cover(context, parts.velvet, 0, 0, width, height, "50% 50%");
  // A spotlight from above on the closed curtain.
  const spotY = story ? 520 : 300;
  const light = context.createRadialGradient(width / 2, spotY, 40, width / 2, spotY, story ? 900 : 700);
  light.addColorStop(0, "rgba(255,226,200,.18)");
  light.addColorStop(0.45, "rgba(0,0,0,.15)");
  light.addColorStop(1, "rgba(0,0,0,.72)");
  fill(context, light, 0, 0, width, height);
  fill(context, vertical(context, 0, height, [[0, "rgba(0,0,0,0)"], [0.6, "rgba(0,0,0,0)"], [1, "rgba(5,3,3,.78)"]]), 0, 0, width, height);

  const center = width / 2;
  const radius = story ? 200 : 130;
  const photoY = story ? 500 : 250;
  context.save();
  context.shadowColor = "rgba(0,0,0,.6)";
  context.shadowBlur = 50;
  context.shadowOffsetY = 18;
  context.beginPath();
  context.arc(center, photoY, radius + 10, 0, Math.PI * 2);
  context.fillStyle = "#ffd60a";
  context.fill();
  context.restore();
  context.save();
  context.beginPath();
  context.arc(center, photoY, radius, 0, Math.PI * 2);
  context.clip();
  if (photo) cover(context, photo, center - radius, photoY - radius, radius * 2, radius * 2, "50% 30%");
  else {
    fill(context, ground, center - radius, photoY - radius, radius * 2, radius * 2);
    context.fillStyle = ink;
    context.font = `${Math.round(radius * 1.1)}px KitTitle, Georgia, serif`;
    context.textAlign = "center";
    context.fillText(card.name.replace(/^@/, "").charAt(0).toUpperCase(), center, photoY + radius * 0.38);
    context.textAlign = "left";
  }
  context.restore();

  const name = fitText(context, card.name, (size) => `${size}px KitTitle, Georgia, serif`, width - 160, story ? 104 : 84, 52, 2);
  context.font = `${name.size}px KitTitle, Georgia, serif`;
  context.fillStyle = ink;
  context.textAlign = "center";
  shadowed(context, 16);
  let y = photoY + radius + (story ? 60 : 40) + name.size * 0.8;
  name.lines.forEach((line, index) => context.fillText(line, center, y + index * name.size * 1.02));
  y += (name.lines.length - 1) * name.size * 1.02;
  if (card.note) {
    y += story ? 66 : 54;
    context.font = "38px KitSans, Arial, sans-serif";
    context.fillStyle = "rgba(247,246,239,.84)";
    context.fillText(card.note, center, y);
  }
  plain(context);
  context.textAlign = "left";

  const foot = footerY(story, height);
  const ribbonHeight = story ? 96 : 84;
  const ribbonY = foot - (story ? 130 : 110);
  // Up to three covers fanned out between the name and the ribbon, as books on a table.
  const shown = covers.filter((image): image is HTMLImageElement => Boolean(image));
  if (shown.length) {
    const room = ribbonY - ribbonHeight / 2 - (story ? 70 : 40) - (y + (story ? 90 : 60));
    const coverHeight = Math.min(story ? 470 : 340, room);
    const coverWidth = Math.round((coverHeight * 9) / 16);
    const middle = y + (story ? 90 : 60) + room / 2;
    const step = coverWidth * 1.02;
    const angles = shown.length === 1 ? [0] : shown.length === 2 ? [-5, 5] : [-8, 0, 8];
    const offsets = shown.length === 1 ? [0] : shown.length === 2 ? [-step / 2, step / 2] : [-step, 0, step];
    const order = shown.length === 3 ? [0, 2, 1] : shown.map((_, index) => index);
    for (const index of order) {
      context.save();
      context.translate(center + offsets[index], middle + (shown.length === 3 && index !== 1 ? coverHeight * 0.06 : 0));
      context.rotate((angles[index] * Math.PI) / 180);
      context.shadowColor = "rgba(0,0,0,.6)";
      context.shadowBlur = 40;
      context.shadowOffsetY = 18;
      fill(context, "#111", -coverWidth / 2, -coverHeight / 2, coverWidth, coverHeight);
      plain(context);
      cover(context, shown[index], -coverWidth / 2, -coverHeight / 2, coverWidth, coverHeight);
      context.restore();
    }
  }
  ribbon(context, parts, ribbonY, story ? 400 : 360, ribbonHeight);
  footer(context, card, width, foot, ink, "rgba(247,246,239,.74)", "left", 96);
}

/** Draws one card at full size. */
export async function drawKitCard(card: KitCard): Promise<HTMLCanvasElement> {
  await loadFonts().catch(() => undefined); // fallback fonts still make a card
  const parts = await loadStage();
  const { width, height } = kitSize[card.format];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image export is unavailable in this browser.");
  context.textBaseline = "alphabetic";
  if (card.style === "poster") await drawPoster(context, card, width, height, parts);
  else if (card.style === "frame") await drawFrame(context, card, width, height, parts);
  else if (card.style === "lines") await drawLines(context, card, width, height, parts);
  else await drawAuthor(context, card, width, height, parts);
  return canvas;
}

/** The card as a JPEG: what stories and posts take everywhere, a third of a PNG's size. */
export async function renderKitCard(card: KitCard): Promise<Blob> {
  const canvas = await drawKitCard(card);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create the card."))), "image/jpeg", 0.92));
}
