import { bokCoverPalette } from "./reader/bok-cover-palette";

export type ShareBok = { id: string; title: string; authorName: string };

export { bokShareUrl } from "@/lib/boks/share-link";

function loadArtwork(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load artwork."));
    image.src = source;
  });
}

export function wrapPosterText(context: Pick<CanvasRenderingContext2D, "measureText">, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/u)) {
    if (context.measureText(word).width > width) {
      if (line) { lines.push(line); line = ""; }
      for (const letter of Array.from(word)) {
        if (line && context.measureText(line + letter).width > width) { lines.push(line); line = ""; }
        line += letter;
      }
    } else if (line && context.measureText(`${line} ${word}`).width > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** Canvas is generated on demand; failed artwork still produces an honest typographic poster. */
export async function renderBokPoster(story: ShareBok, artwork?: string | null): Promise<Blob> {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image export is unavailable in this browser.");
  const palette = bokCoverPalette(story.id);
  context.fillStyle = palette.paper;
  context.fillRect(0, 0, 1080, 1350);
  let hasArtwork = false;
  if (artwork) {
    try {
      const image = await loadArtwork(artwork);
      const scale = Math.max(1080 / image.width, 1350 / image.height);
      context.drawImage(image, (1080 - image.width * scale) / 2, (1350 - image.height * scale) / 2, image.width * scale, image.height * scale);
      hasArtwork = true;
      const shade = context.createLinearGradient(0, 0, 0, 1350);
      shade.addColorStop(0, "rgba(12,18,18,.28)");
      shade.addColorStop(0.36, "rgba(12,18,18,.12)");
      shade.addColorStop(1, "rgba(12,18,18,.88)");
      context.fillStyle = shade;
      context.fillRect(0, 0, 1080, 1350);
    } catch { /* Artwork is optional. The real title and byline remain the poster. */ }
  }
  if (!hasArtwork) {
    context.fillStyle = palette.letter;
    context.font = 'italic 1100px "Boks Literary", Georgia, serif';
    context.fillText(story.title.trim().charAt(0), 450, 1040);
  }
  context.fillStyle = hasArtwork ? "#fff7e9" : palette.ink;
  context.font = 'italic 110px "Boks Literary", Georgia, serif';
  context.fillText("boks", 84, 165);
  let size = 96;
  let titleLines: string[];
  do {
    context.font = `italic ${size}px "Boks Literary", Georgia, serif`;
    titleLines = wrapPosterText(context, story.title, 900);
    if (titleLines.length * size * 1.12 <= 650) break;
    size -= 4;
  } while (size > 32);
  const titleY = 1100 - titleLines.length * size * 1.12;
  titleLines.forEach((line, index) => context.fillText(line, 84, titleY + index * size * 1.12));
  context.font = '36px Arial, Helvetica, sans-serif';
  wrapPosterText(context, story.authorName, 900).slice(0, 3).forEach((line, index) => context.fillText(line, 84, 1135 + index * 44));
  context.font = "24px system-ui, sans-serif";
  context.fillText(window.location.hostname, 84, 1278);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create the card.")), "image/png"));
}
