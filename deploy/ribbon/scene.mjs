// The ribbon card's scene: one picture, any bok or author, drawn at any time t.
//
// A port of the kit's renderer/src/preview.mjs (boks-ribbon-backend-kit,
// 2026-11-11) that needs no browser: everything it draws with is passed in
// (`createCanvas`, decoded images, fonts already registered under the family
// names below), so the same code runs on the server with @napi-rs/canvas
// (Skia) and could run in a page with a real <canvas>. Layout, crop, shading,
// text and layer order are the kit's; only the browser glue is gone.
//
// Layers, back to front: cover (cropped, shaded) -> back of the ribbon ->
// small boks logo, title, byline -> front of the ribbon (the coils that pass
// before the letters) -> the big boks riding the giant pass. The cover and the
// text never move, so they are drawn once; a frame redraws only the ribbon.
import { DEPTH_DURATION, depthAt, drawDepth } from "./motion.mjs";

export const DURATION = DEPTH_DURATION;
export const LOGICAL = { width: 1200, height: 630 };
/** Family names the caller registers the bundled fonts under. */
export const FONT = { title: '"Boks Serif Latin", "Boks Serif Cyrillic"', byline: '"Boks Sans"' };

const W = LOGICAL.width, H = LOGICAL.height;
const LOGO = { x: 61, y: 81, width: 75, height: (75 * 386) / 847 };
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (x) => { const t = clamp(x); return t * t * (3 - 2 * t); };
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (text) => Array.from(segmenter.segment(text), (part) => part.segment);
const sizeOf = (image) => ({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });

/**
 * A card, as the app gives it (`/b/<id>/ribbon`, `/a/<handle>/ribbon`):
 * kind "work" | "author", title, byline, where the window sits on the cover
 * (`position`, CSS object-position as fractions; or the kit's `focalPoint` or
 * `crop`), shade 0..1, optional layout overrides. Text is text, never markup.
 */
export function checkCard(card) {
  if (!card || !["work", "author"].includes(card.kind)) throw new Error("kind must be work or author");
  if (typeof card.title !== "string" || !card.title.trim() || card.title.length > 2000) throw new Error("title is required");
  if (typeof card.byline !== "string" || card.byline.length > 500) throw new Error("byline must be a string");
  if ([card.crop, card.focalPoint, card.position].filter(Boolean).length > 1) throw new Error("one of position, crop, focalPoint");
  for (const value of [card.crop?.x, card.crop?.top, card.focalPoint?.x, card.focalPoint?.y, card.position?.x, card.position?.y, card.shade]) {
    if (value !== undefined && !(typeof value === "number" && value >= 0 && value <= 1)) throw new Error("crop, focal point and shade are 0..1");
  }
  for (const [name, value] of Object.entries(card.layout ?? {})) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`layout.${name} must be a number`);
  }
  if (card.layout?.maxLines !== undefined && ![1, 2].includes(card.layout.maxLines)) throw new Error("maxLines is 1 or 2");
}

function widthOf(ctx, text, size, tracking) {
  ctx.font = `400 ${size}px ${FONT.title}`;
  ctx.letterSpacing = `${tracking}px`;
  return ctx.measureText(text).width;
}

function wrapAt(ctx, text, size, maxWidth, maxLines) {
  const tracking = size * -0.038;
  const lines = [""];
  for (const word of text.trim().replace(/\s+/gu, " ").split(" ")) {
    const current = lines.length - 1;
    const joined = lines[current] ? `${lines[current]} ${word}` : word;
    if (widthOf(ctx, joined, size, tracking) <= maxWidth) { lines[current] = joined; continue; }
    if (lines[current]) lines.push("");
    for (const char of graphemes(word)) {
      const i = lines.length - 1;
      if (lines[i] && widthOf(ctx, lines[i] + char, size, tracking) > maxWidth) lines.push(char);
      else lines[i] += char;
    }
  }
  return { lines, fits: lines.length <= maxLines, tracking };
}

/** Title in up to two lines, 62 down to 36 px, then an ellipsis at a whole grapheme; the byline likewise. */
export function measureLayout(ctx, card) {
  const input = card.layout ?? {};
  const x = input.titleX ?? 61;
  const maxWidth = input.maxWidth ?? W - x - 61;
  const maxLines = input.maxLines ?? 2;
  const initialSize = input.titleSize ?? 62;
  const minSize = input.minTitleSize ?? 36;
  if (!(x >= 0 && x <= 250 && maxWidth > 100 && x + maxWidth <= W - 20)) throw new Error("Title area falls outside the card");
  if (!(minSize >= 24 && initialSize <= 90 && minSize <= initialSize)) throw new Error("Invalid title size range");
  let result, size;
  for (size = initialSize; size >= minSize; size -= 1) {
    result = wrapAt(ctx, card.title, size, maxWidth, maxLines);
    if (result.fits) break;
  }
  let truncated = false;
  if (!result.fits) {
    size = minSize;
    result = wrapAt(ctx, card.title, size, maxWidth, maxLines);
    result.lines = result.lines.slice(0, maxLines);
    let end = result.lines[maxLines - 1];
    while (end && widthOf(ctx, end + "…", size, size * -0.038) > maxWidth) end = graphemes(end).slice(0, -1).join("");
    result.lines[maxLines - 1] = end + "…";
    truncated = true;
  }
  const lineHeight = size * (input.lineHeight ?? 1.1);
  const bylineY = input.bylineY ?? 543;
  const y = input.titleY ?? bylineY - 22 - result.lines.length * lineHeight;
  if (y < 260 || y + result.lines.length * lineHeight > bylineY - 8 || bylineY + 36 > H || bylineY < 300) throw new Error("Text does not fit the title area");
  const targetLine = clamp(Math.round(input.coilLine ?? result.lines.length - 1), 0, result.lines.length - 1);
  const lines = result.lines.map((text, index) => ({ text, x, y: y + lineHeight * index, width: widthOf(ctx, text, size, size * -0.038) }));
  const bylineSize = input.bylineSize ?? 24;
  const bylineX = input.bylineX ?? 64;
  ctx.font = `400 ${bylineSize}px ${FONT.byline}`;
  ctx.letterSpacing = "0px";
  let byline = card.byline;
  while (byline && ctx.measureText(byline).width > maxWidth) byline = graphemes(byline).slice(0, -1).join("");
  if (byline !== card.byline) {
    while (byline && ctx.measureText(byline + "…").width > maxWidth) byline = graphemes(byline).slice(0, -1).join("");
    byline += "…";
  }
  return { lines, size, tracking: size * -0.038, lineHeight, maxWidth, truncated, target: lines[targetLine], byline, bylineX, bylineY, bylineSize };
}

/** The window of the cover the card shows: `cover` fit around the focal point. */
export function artworkWindow(image, card) {
  const { width: iw, height: ih } = sizeOf(image);
  const sw = Math.min(iw, (ih * W) / H);
  const sh = (sw * H) / W;
  let sx, sy;
  if (card.position) {
    sx = card.position.x * (iw - sw);
    sy = card.position.y * (ih - sh);
  } else if (card.crop) {
    sx = clamp(card.crop.x ?? 0.5) * Math.max(0, iw - sw);
    sy = clamp((card.crop.top ?? 0) * ih, 0, ih - sh);
  } else {
    const focal = card.focalPoint ?? { x: 0.5, y: 0.5 };
    sx = clamp(focal.x * iw - sw / 2, 0, iw - sw);
    sy = clamp(focal.y * ih - sh / 2, 0, ih - sh);
  }
  return { sx, sy, sw, sh };
}

function tint(createCanvas, image, fill) {
  const { width, height } = sizeOf(image);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

function capsule(ctx, from, to, y, radius) {
  ctx.beginPath();
  ctx.moveTo(from, y - radius);
  ctx.lineTo(to, y - radius);
  ctx.arc(to, y, radius, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(from, y + radius);
  ctx.arc(from, y, radius, Math.PI / 2, Math.PI * 1.5);
  ctx.closePath();
}

/** The small boks: cream on the cover, ink where the parked ribbon lies under it, cream again on the red disc. */
function smallLogo(ctx, frame, logos) {
  const draw = (image) => ctx.drawImage(image, LOGO.x, LOGO.y, LOGO.width, LOGO.height);
  draw(logos.cream);
  if (frame.logo[0] <= frame.logo[1]) {
    ctx.save();
    capsule(ctx, frame.logo[0], frame.logo[1], 98, frame.radius);
    ctx.clip();
    draw(logos.ink);
    ctx.restore();
  }
  if (frame.logo[2] > -100) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(frame.logo[2], 98, frame.radius * 0.728, 0, Math.PI * 2);
    ctx.clip();
    draw(logos.cream);
    ctx.restore();
  }
}

function drawText(ctx, layout) {
  ctx.save();
  ctx.textBaseline = "top";
  ctx.font = `400 ${layout.size}px ${FONT.title}`;
  ctx.letterSpacing = `${layout.tracking}px`;
  ctx.fillStyle = "#faf4e9";
  ctx.shadowColor = "rgba(20,16,12,.20)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  for (const line of layout.lines) ctx.fillText(line.text, line.x, line.y);
  ctx.font = `400 ${layout.bylineSize}px ${FONT.byline}`;
  ctx.letterSpacing = "0px";
  ctx.shadowColor = "rgba(21,16,13,.68)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 1;
  if (layout.byline) ctx.fillText(layout.byline, layout.bylineX, layout.bylineY);
  ctx.restore();
}

/** Cover, cropped and shaded under the text (the kit's gradient, as one pass of pixels). */
function background(createCanvas, image, card, width, height, scale) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1c242a"; // the ground of a bok without a cover
  ctx.fillRect(0, 0, width, height);
  if (image) {
    const crop = artworkWindow(image, card);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, W, H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  const shade = clamp(card.shade ?? (card.kind === "author" ? 0.1 : 0.62));
  const overlay = createCanvas(width, height);
  const paint = overlay.getContext("2d");
  const pixels = paint.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const v = y / height;
    const bottom = smooth((v - 0.51) / 0.49);
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const left = 1 - smooth((u - 0.32) / 0.44);
      const corner = (1 - smooth(u / 0.28)) * (1 - smooth(v / 0.32));
      pixels.data[(y * width + x) * 4 + 3] = Math.round(255 * clamp(shade * (bottom * (0.17 + 0.83 * left) + 0.25 * corner)));
    }
  }
  paint.putImageData(pixels, 0, 0);
  ctx.drawImage(overlay, 0, 0);
  return canvas;
}

/**
 * The scene for one card. `width` is the output width (40:21, even); the
 * canvas is drawn at `density` times that and handed back whole, so the
 * caller scales it down once per frame (the kit's rule: never a 1x ribbon).
 *
 * @param {object} card see checkCard
 * @param {{createCanvas: (w: number, h: number) => any, image: any | null, logo: any, width?: number, density?: number}} env
 */
export function createScene(card, env) {
  checkCard(card);
  const outputWidth = env.width ?? 960;
  const outputHeight = (outputWidth * H) / W;
  if (!Number.isInteger(outputHeight) || outputWidth % 2 || outputHeight % 2) throw new Error("Output must be even and 40:21");
  const density = env.density ?? 2;
  const scale = (outputWidth / W) * density;
  const width = Math.round(outputWidth * density), height = Math.round(outputHeight * density);
  const { createCanvas } = env;

  const layout = measureLayout(createCanvas(1, 1).getContext("2d"), card);
  const base = background(createCanvas, env.image, card, width, height, scale);
  const logos = { cream: tint(createCanvas, env.logo, "#f9f3e5"), ink: tint(createCanvas, env.logo, "#121f28"), giant: tint(createCanvas, env.logo, "#090c0d") };
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const back = createCanvas(width, height), front = createCanvas(width, height);
  const backCtx = back.getContext("2d"), frontCtx = front.getContext("2d");
  backCtx.setTransform(scale, 0, 0, scale, 0, 0);
  frontCtx.setTransform(scale, 0, 0, scale, 0, 0);
  const target = layout.target;

  return {
    canvas,
    layout,
    width,
    height,
    /** Draws time t (seconds, wrapped to the loop); deterministic, independent of order. */
    renderFrame(time) {
      if (!Number.isFinite(time)) throw new Error("time must be finite");
      const t = ((time % DURATION) + DURATION) % DURATION;
      const frame = depthAt(t, Math.max(250, target.width), layout.size, target.x, target.y);
      drawDepth(backCtx, frame, "back", W, H);
      drawDepth(frontCtx, frame, "front", W, H);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(base, 0, 0);
      ctx.drawImage(back, 0, 0);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      smallLogo(ctx, frame, logos);
      drawText(ctx, layout);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(front, 0, 0);
      if (frame.giant) {
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.drawImage(logos.giant, frame.giantLogoX, frame.giantLogoY, frame.giantLogoWidth, (frame.giantLogoWidth * 386) / 847);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      return { time: t, giant: frame.giant };
    },
  };
}
