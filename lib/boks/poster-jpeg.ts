/**
 * A rendered poster (PNG) as a JPEG, for link previews.
 *
 * A poster is mostly a painting, and as a PNG it weighs 0.9-1.5 MB. Telegram
 * started downloading the 1.5 MB one and gave up after a second, so the
 * Dostoevsky link previewed with no picture (2026-11-09). As a JPEG the same
 * poster is a few hundred KB. Pure JavaScript (pngjs, jpeg-js), so nothing
 * here depends on a native binary for the server's platform.
 */
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

export const posterJpegQuality = 84;

export function posterPngToJpeg(png: ArrayBuffer | Uint8Array, quality = posterJpegQuality): Uint8Array<ArrayBuffer> {
  const decoded = PNG.sync.read(Buffer.from(png instanceof Uint8Array ? png : new Uint8Array(png)));
  const encoded = jpeg.encode({ data: decoded.data, width: decoded.width, height: decoded.height }, quality);
  const out = new Uint8Array(new ArrayBuffer(encoded.data.length));
  out.set(encoded.data);
  return out;
}
