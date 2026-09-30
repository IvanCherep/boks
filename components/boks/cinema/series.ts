import { narrationTrackFor } from "@/components/boks/cinema/narration-track";
import { sceneImagesFor } from "@/components/boks/cinema/scene-image";

/**
 * Is this boks finished to the standard the cover signs?
 *
 * Both halves, or neither: pictures made for these scenes and a voice that
 * actually read this text. A piece with one of the two is a piece in progress -
 * a recording over the shared stand-in, or paintings read by the browser's
 * robot - and showing either to a reader would spend the idea rather than make
 * the case for it.
 *
 * This is also who may open it. Anyone can listen to a finished piece; every
 * other boks keeps the prototype behind the admin flag, where it can be shown
 * on purpose and not stumbled into. Nothing lists which boks are open, because
 * a list is a thing to forget to update: finish a piece and it opens itself.
 */
export function isBoksSeriesPiece(storyId: string) {
  return sceneImagesFor(storyId).length > 0 && Boolean(narrationTrackFor(storyId));
}
