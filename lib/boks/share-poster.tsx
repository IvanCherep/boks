import type { SharedBok } from "./share-preview";
import { bokCoverPalette } from "@/components/boks/reader/bok-cover-palette";

// The original Series covers are 720px wide. Keep their native resolution;
// upscaling to 1080px adds PNG work on the edge without adding image detail.
export const sharePosterSize = { width: 720, height: 900 };
const px = (value: number) => value * sharePosterSize.width / 1080;

/** Same portrait composition as Share bok: artwork, wordmark, title and byline. */
export function SharePoster({ bok, artwork }: { bok: SharedBok; artwork?: string }) {
  const palette = bokCoverPalette(bok.id);
  const titleSize = bok.title.length > 100 ? 72 : bok.title.length > 60 ? 88 : 108;
  return <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: px(73), position: "relative", overflow: "hidden", background: palette.paper, color: artwork ? "#fff7e9" : palette.ink, fontFamily: "PosterSans" }}>
    {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders this into the PNG. */}
    {artwork && <img src={artwork} alt="" width={sharePosterSize.width} height={sharePosterSize.height} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
    {artwork && <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", backgroundImage: "linear-gradient(180deg, #08111c47 0%, #08111c00 24%, #08111c00 40%, #07101833 54%, #071018db 100%)" }} />}
    {!artwork && <div style={{ position: "absolute", right: px(-65), top: px(170), fontFamily: "PosterSerif", fontStyle: "italic", fontSize: px(1080), lineHeight: .8, color: palette.letter }}>{bok.title.trim().charAt(0)}</div>}
    <div style={{ display: "flex", fontFamily: "PosterSerif", fontStyle: "italic", fontSize: px(116), letterSpacing: px(-8), lineHeight: .9 }}>boks</div>
    <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", paddingTop: px(100) }}>
      <div style={{ display: "flex", fontFamily: "PosterSerif", fontStyle: "italic", fontSize: px(titleSize), lineHeight: 1.04, letterSpacing: px(-2.4), overflowWrap: "break-word" }}>{bok.title}</div>
      {bok.authorName && <div style={{ display: "flex", fontSize: px(36), lineHeight: 1.4, marginTop: px(40), opacity: .85 }}>{bok.authorName}</div>}
    </div>
    <div style={{ display: "flex", fontSize: px(27), letterSpacing: px(3.3), marginTop: px(85), opacity: .62 }}>tryboks.com</div>
  </div>;
}
