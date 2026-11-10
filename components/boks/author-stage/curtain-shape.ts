/**
 * The author stage's curtain geometry (design: boks-author-stage handoff,
 * 2026-11-10), in CSS pixels: where the cloth's edge runs for an opening from
 * 0 (closed) to 1 (open). Shared by the WebGL cloth (`curtain-gl.ts`), the CSS
 * fallback, the ribbon and the drag area, so all of them agree. Small and
 * loaded at once; the WebGL part loads after first paint.
 */
export const CURTAIN_TIE_Y = 0.56;


export const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const BEND_RADIUS = 0.085;
const TUCK_START = 0.86;
const TUCKED_SHOULDER = 0.23;
const lerp = (from: number, to: number, phase: number) => from + (to - from) * phase;

export function narrowStage(width: number, height: number) {
  const ratio = clamp((1.45 - width / Math.max(1, height)) / 0.65);
  return ratio * ratio * (3 - 2 * ratio);
}

export function usesCompactCurtain(width: number) {
  return width <= 700;
}

function curtainBend(unit: number) {
  return (Math.hypot(unit, BEND_RADIUS) - BEND_RADIUS) / (Math.hypot(1, BEND_RADIUS) - BEND_RADIUS);
}

function compactLogoFlare(width: number, height: number, waist: number) {
  // The compact CSS mark is 62px wide. Fit the shoulder behind its lower
  // right corner with room for the stage gutter and a phone's top safe area.
  const gutter = Math.max(18, width * .048);
  const inkRight = gutter + 62 + 7;
  const inkBottom = width > height ? 70 : Math.min(92, Math.max(76, height * .11));
  const unit = 1 - Math.min(.8, inkBottom / Math.max(1, height * CURTAIN_TIE_Y));
  return (inkRight - waist) / curtainBend(unit);
}

// Coordinates in CSS pixels. The spreads describe the shoulders at the top
// and bottom, with the puck following the edge at the waist.
export function curtainShape(open: number, width: number, height: number) {
  const reveal = clamp(open);
  const mobile = narrowStage(width, height);
  const compact = usesCompactCurtain(width);
  const minimum = Math.min(108, 72 + width * .025, width * .24);
  const standardEdge = Math.max(minimum, width * lerp(.134, .115, mobile));
  const tuckedEdge = Math.max(28, Math.min(43, width * .03));
  const edge = lerp(width * 1.02, compact ? tuckedEdge : standardEdge, reveal);
  const shoulder = width * lerp(221 / 1920, .151, mobile);
  // Keep the puck tied to pointer travel while the cloth catches up near the wall.
  const tuck = compact ? clamp((reveal - TUCK_START) / (1 - TUCK_START)) : 0;
  const easeTuck = tuck * tuck * tuck * (tuck * (tuck * 6 - 15) + 10);
  const gather = reveal * (1 + .24 * (1 - reveal));
  const logoFlare = compact ? compactLogoFlare(width, height, tuckedEdge) : shoulder;
  const upperFlare = lerp(Math.max(shoulder, logoFlare), logoFlare, easeTuck) * gather;
  const lowerShoulder = shoulder * (162 / 221);
  const gatheredHem = Math.max(22, lowerShoulder * TUCKED_SHOULDER);
  const lowerFlare = lerp(lowerShoulder, gatheredHem, easeTuck) * gather;
  return { edge, upperFlare, lowerFlare };
}

export function curtainEdge(open: number, width: number, height: number) {
  return curtainShape(open, width, height).edge;
}

export function curtainEdgeAt(open: number, width: number, height: number, normalizedY: number) {
  const reveal = clamp(open);
  const { edge, upperFlare, lowerFlare } = curtainShape(reveal, width, height);
  const dy = clamp(normalizedY) - CURTAIN_TIE_Y;
  const unit = dy / (dy > 0 ? 1 - CURTAIN_TIE_Y : CURTAIN_TIE_Y);
  const bend = curtainBend(unit);
  const closure = .24 * (1 - reveal);
  return edge + (dy > 0 ? lowerFlare : upperFlare) * bend * (1 + closure * bend) / (1 + closure);
}

