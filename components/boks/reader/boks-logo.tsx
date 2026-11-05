"use client";

import { useSyncExternalStore } from "react";

const seasonalDecorations = [
  "/design/new-year-fir-v1.png",
  "/design/new-year-bauble-v1.png",
  "/design/new-year-hat-v1.png",
  "/design/new-year-snowman-v1.png",
  "/design/new-year-snowglobe-v1.png",
];

// Choose once for the browser document, shared by every logo until a reload.
// The server renders no ornament; its hydration snapshot stays identical.
const documentDecoration = typeof window === "undefined"
  ? null
  : seasonalDecorations[Math.floor(Math.random() * seasonalDecorations.length)];
const subscribe = () => () => undefined;
const readDecoration = () => documentDecoration;
const readServerDecoration = () => null;

/** Seasonal decoration remains explicit, with no automatic calendar rule. */
export function BoksLogo({ series = false, seasonal = true, className = "" }: {
  series?: boolean;
  seasonal?: boolean;
  className?: string;
}) {
  const decoration = useSyncExternalStore(subscribe, readDecoration, readServerDecoration);

  return <span className={`boks-logo ${className}`}>
    boks{series && <span className="boks-logo__series">Series</span>}
    {seasonal && decoration && <img className="boks-logo__season" src={decoration} alt="" />}
  </span>;
}
