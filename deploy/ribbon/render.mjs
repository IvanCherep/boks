// Renders one ribbon card into its two files, with no browser: Skia
// (@napi-rs/canvas) draws the frames, ffmpeg encodes them.
//
//   poster: 1200x630 JPEG, frame 0 (the parked ribbon under boks), og:image
//   loop:   960x504 H.264 MP4, 30 fps, 342 frames = 11.4 s, silent, og:video
//
// Frames go to ffmpeg as raw pixels through a pipe, nothing is written per
// frame. Both files are written as `.part` and renamed, so a reader of the
// folder only ever sees whole files.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, loadImage, Path2D } from "@napi-rs/canvas";
import { DURATION, createScene } from "./scene.mjs";

// motion.mjs draws with the browser's global Path2D.
globalThis.Path2D ??= Path2D;

const here = dirname(fileURLToPath(import.meta.url));
export const FPS = 30;
export const FRAMES = Math.round(DURATION * FPS); // 342
export const LOOP = { width: 960, height: 504, crf: 26 };
export const POSTER = { width: 1200, height: 630, quality: 86 };

let fonts = false;
function registerFonts() {
  if (fonts) return;
  GlobalFonts.registerFromPath(join(here, "assets/source-serif-4-latin.woff2"), "Boks Serif Latin");
  GlobalFonts.registerFromPath(join(here, "assets/source-serif-4-cyrillic.woff2"), "Boks Serif Cyrillic");
  GlobalFonts.registerFromPath(join(here, "assets/noto-sans.ttf"), "Boks Sans");
  fonts = true;
}

let logo;
const loadLogo = () => (logo ??= loadImage(join(here, "assets/boks-logo.png")));

/** Decodes the cover, refusing anything that is not a reasonable picture. */
export async function decodeImage(bytes) {
  if (!bytes || bytes.length < 100 || bytes.length > 20 * 1024 * 1024) return null;
  try {
    const image = await loadImage(Buffer.from(bytes));
    if (!(image.width >= 64 && image.height >= 64 && image.width <= 8000 && image.height <= 8000)) return null;
    return image;
  } catch {
    return null;
  }
}

function scaled(scene, width, height) {
  const out = createCanvas(width, height);
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return {
    canvas: out,
    draw() {
      ctx.drawImage(scene.canvas, 0, 0, width, height);
      return ctx;
    },
  };
}

/** The poster alone: JPEG bytes. */
export async function renderPoster(card, image) {
  registerFonts();
  const scene = createScene(card, { createCanvas, image, logo: await loadLogo(), width: POSTER.width, density: 2 });
  scene.renderFrame(0);
  const out = scaled(scene, POSTER.width, POSTER.height);
  out.draw();
  return out.canvas.encode("jpeg", POSTER.quality);
}

/**
 * The loop, written to `file` (whole or not at all). `nice` and one thread
 * keep it from taking the server from the readers; the caller decides when.
 */
export async function renderLoop(card, image, file, { threads = 1 } = {}) {
  registerFonts();
  const scene = createScene(card, { createCanvas, image, logo: await loadLogo(), width: LOOP.width, density: 2 });
  const out = scaled(scene, LOOP.width, LOOP.height);
  const partial = join(dirname(file), `.${file.split("/").at(-1)}.part`);
  const encoder = spawn(
    "nice",
    [
      "-n", "10", "ffmpeg", "-nostdin", "-v", "error", "-y",
      "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${LOOP.width}x${LOOP.height}`, "-framerate", String(FPS), "-i", "pipe:0",
      "-an", "-c:v", "libx264", "-preset", "slow", "-crf", String(LOOP.crf), "-pix_fmt", "yuv420p",
      "-threads", String(threads), "-movflags", "+faststart", "-f", "mp4", partial,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let errors = "";
  encoder.stderr.on("data", (chunk) => (errors += chunk));
  encoder.stdin.on("error", () => {});
  const closed = once(encoder, "close");
  try {
    for (let index = 0; index < FRAMES; index += 1) {
      if (encoder.exitCode !== null) throw new Error(errors || "ffmpeg stopped early");
      // Frame n at n/342 of the motion: the last frame is one step before the first, so the loop has no seam.
      scene.renderFrame((index / FRAMES) * DURATION);
      const pixels = out.draw().getImageData(0, 0, LOOP.width, LOOP.height).data;
      if (!encoder.stdin.write(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength))) await once(encoder.stdin, "drain");
    }
    encoder.stdin.end();
    const [code] = await closed;
    if (code !== 0) throw new Error(`ffmpeg ${code}: ${errors.slice(-400)}`);
    await rename(partial, file);
  } catch (error) {
    encoder.kill("SIGKILL");
    await rm(partial, { force: true });
    throw error;
  }
}

/** Both files for a card into `dir`, named by `name` (`<name>.jpg`, `<name>.mp4`). */
export async function renderCard(card, imageBytes, dir, name) {
  const image = imageBytes ? await decodeImage(imageBytes) : null;
  const poster = await renderPoster(card, image);
  const posterPart = join(dir, `.${name}.jpg.part`);
  await writeFile(posterPart, poster);
  await rename(posterPart, join(dir, `${name}.jpg`));
  await renderLoop(card, image, join(dir, `${name}.mp4`));
}
