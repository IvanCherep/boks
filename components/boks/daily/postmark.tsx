"use client";

/**
 * The postmark: boks's mark on anything that travels between readers - a
 * dashed, slightly turned stamp in the serif italic, as on the feedback page
 * (`.you-postmark`). `sealed` adds the wax seal of a letter not yet opened;
 * `stamp` presses it in once, for a line just sent.
 */
export function Postmark({ caption, sealed = false, stamp = false, size = "s" }: {
  caption: string;
  sealed?: boolean;
  stamp?: boolean;
  size?: "s" | "l";
}) {
  return <span className={`postmark postmark--${size}${stamp ? " postmark--stamp" : ""}`} aria-hidden="true">
    <span className="postmark__mark">boks</span>
    <span className="postmark__caption">{caption}</span>
    {sealed && <i className="postmark__seal" />}
  </span>;
}
