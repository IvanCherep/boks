/**
 * The author's photo, cropped in the browser (`profile-editor.tsx`).
 *
 * The author drags and zooms the photo under a circle; what is kept is the
 * square behind the circle, re-encoded as a 640x640 JPEG. Re-encoding drops
 * whatever the camera wrote into the file (location included), and a fixed
 * small size keeps it cheap to store in the database and to send to a
 * messenger as a link preview (`author_spaces.photo`, `app/a/[handle]/photo`).
 */

export const photoAcceptedTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export const photoMaxBytes = 10 * 1024 * 1024;
export const photoSide = 640;
export const zoomMin = 1;
export const zoomMax = 3;

/**
 * Where the photo sits: `zoom` 1 fits its short side to the square, `x` and
 * `y` move it in units of the square's side (0 = centred).
 */
export type Crop = { width: number; height: number; zoom: number; x: number; y: number };

export type PhotoProblem = "badType" | "photoTooLarge" | null;

export function photoProblem(file: { type: string; size: number }): PhotoProblem {
  if (!(photoAcceptedTypes as readonly string[]).includes(file.type)) return "badType";
  if (file.size > photoMaxBytes) return "photoTooLarge";
  return null;
}

/** The same crop, moved back inside the photo: the square is never left with an empty edge. */
export function clampCrop(crop: Crop): Crop {
  const zoom = Math.min(zoomMax, Math.max(zoomMin, Number.isFinite(crop.zoom) ? crop.zoom : 1));
  const short = Math.min(crop.width, crop.height);
  const maxX = ((crop.width / short) * zoom - 1) / 2;
  const maxY = ((crop.height / short) * zoom - 1) / 2;
  const clamp = (value: number, max: number) => Math.max(-max, Math.min(max, Number.isFinite(value) ? value : 0));
  return { ...crop, zoom, x: clamp(crop.x, maxX), y: clamp(crop.y, maxY) };
}

/** The square of the original photo the crop keeps, in its own pixels. */
export function cropSource(crop: Crop) {
  const c = clampCrop(crop);
  const side = Math.min(c.width, c.height) / c.zoom;
  return {
    sx: (c.width - side) / 2 - c.x * side,
    sy: (c.height - side) / 2 - c.y * side,
    side,
  };
}

/** How the photo is laid over a square frame `size` pixels wide, for the editor. */
export function cropLayout(crop: Crop, size: number) {
  const c = clampCrop(crop);
  const short = Math.min(c.width, c.height);
  const width = (c.width / short) * c.zoom * size;
  const height = (c.height / short) * c.zoom * size;
  return { width, height, left: (size - width) / 2 + c.x * size, top: (size - height) / 2 + c.y * size };
}

/** The kept square as a JPEG, base64 without the data-URL prefix. Browser only. */
export function encodeCrop(image: CanvasImageSource, crop: Crop): string {
  const { sx, sy, side } = cropSource(crop);
  const size = Math.max(1, Math.min(photoSide, Math.round(side)));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas.");
  // A transparent PNG would turn black in a JPEG.
  context.fillStyle = "#f3efe7";
  context.fillRect(0, 0, size, size);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, sx, sy, side, side, 0, 0, size, size);
  const url = canvas.toDataURL("image/jpeg", 0.86);
  if (!url.startsWith("data:image/jpeg;base64,")) throw new Error("No JPEG encoder.");
  return url.slice("data:image/jpeg;base64,".length);
}
