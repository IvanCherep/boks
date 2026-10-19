import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };
function glyph(body: ReactNode) {
  return function ReaderGlyph({ size = 24, ...props }: IconProps) {
    return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{body}</svg>;
  };
}
// Accepted v44 glyphs, independent of the prototype's screen router.
export const ReaderBookIcon = glyph(<path d="M3.5 4.5h6L12 7l2.5-2.5h6v15h-6L12 21l-2.5-1.5h-6zM12 7v14M6 8h3M15 8h3" />);
export const ReaderFilmIcon = glyph(<><path d="M4 3.5h16v17H4zM4 7h16M4 17h16M8 3.5V7M16 3.5V7M8 17v3.5M16 17v3.5" /><path d="m10 9.5 4.5 2.5-4.5 2.5z" fill="currentColor" stroke="none" /></>);
export const ReaderUserIcon = glyph(<><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></>);
export const ReaderHeartIcon = glyph(<path d="M12 20.5 3.8 12a5.1 5.1 0 0 1 7.4-7l.8.9.8-.9a5.1 5.1 0 0 1 7.4 7z" />);
export const ReaderCommentsIcon = glyph(<path d="M20.5 11.5a8.5 8.5 0 1 0-15.4 5l-1.2 4.6 4.7-1.5a8.5 8.5 0 0 0 11.9-8.1Z" />);
export const ReaderShareIcon = glyph(<path d="m3 4 19 8-19 8 4-8zm4 8h15" />);
export const ReaderNextIcon = glyph(<path d="M3 12h17m-6-6 6 6-6 6" />);
export const ReaderBackIcon = glyph(<path d="M21 12H4m6-6-6 6 6 6" />);
export const ReaderDownIcon = glyph(<path d="M12 3v17m-6-6 6 6 6-6" />);
export const ReaderPlayIcon = glyph(<path d="m8 4 12 8-12 8z" fill="currentColor" stroke="none" />);
export const ReaderTypeIcon = glyph(<path d="M3 7V4h16v3M11 4v16M7 20h8M17 12h6m-3 0v8" />);
export const ReaderSettingsIcon = glyph(<path d="M3 7h8m4 0h6M3 17h3m4 0h11M11 4v6M6 14v6" />);
export const ReaderMoreIcon = glyph(<><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>);
