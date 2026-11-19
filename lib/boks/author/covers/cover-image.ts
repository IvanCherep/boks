/**
 * A cover as the database keeps it (`save_my_bok`), made in the browser from
 * whatever the author chose - a photo they uploaded or a picture drawn for
 * them: cut to the reader's 9:16 around its middle, 1080x1920, as a WebP for
 * the reader and a JPEG for link previews. A browser that writes no WebP
 * (Safari) sends the JPEG for both.
 */

export const coverSize = { width: 1080, height: 1920 } as const;

/** Uploads larger than this are refused before they are even decoded. */
export const maxUploadBytes = 25 * 1024 * 1024;

export type PreparedCover = {
  source: "upload" | "generated";
  webp: string;
  jpeg: string;
  /** An object URL of the reader's picture, to show at once. */
  preview: string;
};

/** Where a cover of `width`x`height` is cut to 9:16: the largest middle window. */
export function coverCrop(width: number, height: number) {
  const target = coverSize.width / coverSize.height;
  if (width / height > target) {
    const cropWidth = Math.round(height * target);
    return { x: Math.round((width - cropWidth) / 2), y: 0, width: cropWidth, height };
  }
  const cropHeight = Math.round(width / target);
  return { x: 0, y: Math.round((height - cropHeight) / 2), width, height: cropHeight };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // HEIC and friends in some browsers: try an <img>, which may know more.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class CoverImageError extends Error {
  constructor(readonly code: "too_large" | "unreadable") {
    super(code);
  }
}

export async function prepareCover(blob: Blob, source: PreparedCover["source"]): Promise<PreparedCover> {
  if (blob.size > maxUploadBytes) throw new CoverImageError("too_large");
  let image: ImageBitmap | HTMLImageElement;
  try {
    image = await decode(blob);
  } catch {
    throw new CoverImageError("unreadable");
  }
  const width = "naturalWidth" in image ? image.naturalWidth : image.width;
  const height = "naturalHeight" in image ? image.naturalHeight : image.height;
  if (!width || !height) throw new CoverImageError("unreadable");
  const crop = coverCrop(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = coverSize.width;
  canvas.height = coverSize.height;
  const context = canvas.getContext("2d");
  if (!context) throw new CoverImageError("unreadable");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, coverSize.width, coverSize.height);
  if ("close" in image) image.close();

  const jpeg = await toBlob(canvas, "image/jpeg", 0.86);
  if (!jpeg) throw new CoverImageError("unreadable");
  const webpBlob = await toBlob(canvas, "image/webp", 0.82);
  const reader = webpBlob && webpBlob.type === "image/webp" ? webpBlob : jpeg;
  return { source, webp: await base64(reader), jpeg: await base64(jpeg), preview: URL.createObjectURL(reader) };
}
