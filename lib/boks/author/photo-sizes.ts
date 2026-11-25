/**
 * The author's photo at the size a screen shows it (`app/a/[handle]/photo`).
 *
 * One stored photo (`author_spaces.photo`) served everywhere meant a 64 px
 * avatar on the Series shelf downloaded the whole 1254 px original, 150-400
 * KB per author (2026-11-26). The address now names a size:
 *
 *   ?s=s   192 px, for avatars up to 64 CSS px (shelf, search, follows, sheet)
 *   ?s=l   1080 px, for the portrait and the curtain (up to ~1100 device px on a phone)
 *   none   the stored original: link previews and server-drawn cards
 *
 * Both sizes are grayscale, as every author photo is shown (a CSS filter), so
 * no bytes go on colour nobody sees. A photo already that small is sent as it
 * is. Pure JavaScript (jpeg-js), like `poster-jpeg.ts`: the server build has
 * no native image library. Each size is made once per photo version and kept
 * in memory; the address carries the version, so a new photo is a new entry.
 */
import jpeg from "jpeg-js";
import type { PhotoSize } from "./photo-path";

export const photoSizes: Record<PhotoSize, { side: number; quality: number }> = {
  s: { side: 192, quality: 84 },
  l: { side: 1080, quality: 82 },
};

/**
 * The square photo at `side` px, grayscale, as a JPEG. Downscaling averages
 * every source pixel a target pixel covers (a box filter with fractional
 * edges), which keeps a face sharp without the shimmer of point sampling.
 */
export function resizeAuthorPhoto(original: Uint8Array, size: PhotoSize): Uint8Array<ArrayBuffer> {
  const { side, quality } = photoSizes[size];
  const decoded = jpeg.decode(original, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 });
  const { width, height, data } = decoded;
  // A centred square, as the photo editor saves it (older photos may not be square).
  const crop = Math.min(width, height);
  const left = Math.floor((width - crop) / 2);
  const top = Math.floor((height - crop) / 2);
  const target = Math.min(side, crop);

  // Luminance of the crop, once.
  const luma = new Float32Array(crop * crop);
  for (let y = 0; y < crop; y += 1) {
    let from = ((top + y) * width + left) * 4;
    const row = y * crop;
    for (let x = 0; x < crop; x += 1, from += 4) {
      luma[row + x] = 0.299 * data[from] + 0.587 * data[from + 1] + 0.114 * data[from + 2];
    }
  }

  const scaled = target === crop ? luma : boxResize(luma, crop, target);
  const out = new Uint8Array(target * target * 4);
  for (let index = 0, to = 0; index < scaled.length; index += 1, to += 4) {
    const value = Math.max(0, Math.min(255, Math.round(scaled[index])));
    out[to] = out[to + 1] = out[to + 2] = value;
    out[to + 3] = 255;
  }
  const encoded = jpeg.encode({ data: out, width: target, height: target }, quality);
  const bytes = new Uint8Array(new ArrayBuffer(encoded.data.length));
  bytes.set(encoded.data);
  return bytes;
}

/** Area-average a square `from` px wide down to `to` px, rows then columns. */
function boxResize(source: Float32Array, from: number, to: number): Float32Array {
  const weights = boxWeights(from, to);
  const rows = new Float32Array(from * to);
  for (let y = 0; y < from; y += 1) {
    const base = y * from;
    for (let x = 0; x < to; x += 1) {
      const { start, w } = weights[x];
      let sum = 0;
      for (let k = 0; k < w.length; k += 1) sum += source[base + start + k] * w[k];
      rows[y * to + x] = sum;
    }
  }
  const out = new Float32Array(to * to);
  for (let y = 0; y < to; y += 1) {
    const { start, w } = weights[y];
    for (let x = 0; x < to; x += 1) {
      let sum = 0;
      for (let k = 0; k < w.length; k += 1) sum += rows[(start + k) * to + x] * w[k];
      out[y * to + x] = sum;
    }
  }
  return out;
}

function boxWeights(from: number, to: number) {
  const scale = from / to;
  return Array.from({ length: to }, (_, index) => {
    const begin = index * scale;
    const end = begin + scale;
    const start = Math.floor(begin);
    const stop = Math.min(from, Math.ceil(end));
    const w = new Float32Array(stop - start);
    for (let k = start; k < stop; k += 1) w[k - start] = (Math.min(end, k + 1) - Math.max(begin, k)) / scale;
    return { start, w };
  });
}

const made = new Map<string, Uint8Array<ArrayBuffer>>();
const keep = 240;

/** `resizeAuthorPhoto`, made once per handle, version and size (the oldest entries go first). */
export function sizedAuthorPhoto(key: string, original: Uint8Array, size: PhotoSize): Uint8Array<ArrayBuffer> {
  const id = `${key}\u0000${size}`;
  const hit = made.get(id);
  if (hit) {
    made.delete(id);
    made.set(id, hit);
    return hit;
  }
  const bytes = resizeAuthorPhoto(original, size);
  made.set(id, bytes);
  while (made.size > keep) made.delete(made.keys().next().value as string);
  return bytes;
}
