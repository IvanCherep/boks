"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

const ink = [255, 248, 235];
const shade = [7, 16, 20];

function luminance(rgb: number[]) {
  const linear = rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}

function requiredShade(rgb: number[], opacity: number) {
  const contrast = (alpha: number) => {
    const background = rgb.map((value, i) => value * (1 - alpha) + shade[i] * alpha);
    const foreground = ink.map((value, i) => value * opacity + background[i] * (1 - opacity));
    return (luminance(foreground) + .05) / (luminance(background) + .05);
  };
  if (contrast(0) >= 4.5) return 0;
  let low = 0, high = .82;
  for (let i = 0; i < 8; i++) {
    const middle = (low + high) / 2;
    if (contrast(middle) >= 4.5) high = middle;
    else low = middle;
  }
  return high;
}

/** Analyse only the current cover, at thumbnail resolution, behind actual text lines. */
function headingShade(heading: HTMLElement, image: HTMLImageElement, cover: HTMLElement) {
  const bounds = cover.getBoundingClientRect();
  if (!bounds.width || !bounds.height || !image.naturalWidth) return .75;
  const canvas = document.createElement("canvas");
  canvas.width = 80;
  canvas.height = Math.max(1, Math.round(80 * bounds.height / bounds.width));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return .75;
  const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const [x, y] = getComputedStyle(image).objectPosition.split(" ").map(value => Number.parseFloat(value) / 100);
  context.drawImage(image, (canvas.width - image.naturalWidth * scale) * x, (canvas.height - image.naturalHeight * scale) * y, image.naturalWidth * scale, image.naturalHeight * scale);
  // Include the existing cover-wide shade; the new local gradient is not sampled.
  const base = context.createLinearGradient(0, 0, 0, canvas.height);
  base.addColorStop(0, "#091a2233"); base.addColorStop(.44, "transparent"); base.addColorStop(1, "#091a2299");
  context.fillStyle = base; context.fillRect(0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let alpha = 0;
  for (const element of heading.querySelectorAll<HTMLElement>("h1, .reader-cover__byline, .reader-cover__summary")) {
    const visible = element.getBoundingClientRect();
    const opacity = Number(getComputedStyle(element).opacity);
    const range = document.createRange(); range.selectNodeContents(element);
    for (const line of range.getClientRects()) {
      const left = Math.max(0, Math.floor((Math.max(line.left, visible.left) - bounds.left) / bounds.width * canvas.width));
      const right = Math.min(canvas.width, Math.ceil((Math.min(line.right, visible.right) - bounds.left) / bounds.width * canvas.width));
      const top = Math.max(0, Math.floor((Math.max(line.top, visible.top) - bounds.top) / bounds.height * canvas.height));
      const bottom = Math.min(canvas.height, Math.ceil((Math.min(line.bottom, visible.bottom) - bounds.top) / bounds.height * canvas.height));
      const needed: number[] = [];
      for (let py = top; py < bottom; py += 2) for (let px = left; px < right; px += 2) {
        const index = (py * canvas.width + px) * 4;
        needed.push(requiredShade([data[index], data[index + 1], data[index + 2]], opacity));
      }
      // A few specular highlights need not turn a naturally dark scene black.
      needed.sort((a, b) => a - b);
      if (needed.length) alpha = Math.max(alpha, needed[Math.floor((needed.length - 1) * .8)]);
    }
  }
  return alpha < .08 ? 0 : Math.min(.82, alpha + .05);
}

export function CoverHeading({ artwork, children }: { artwork: string | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const heading = ref.current;
    const cover = heading?.closest<HTMLElement>(".reader-cover");
    const image = cover?.querySelector<HTMLImageElement>(".reader-cover__art");
    if (!heading || !cover || !artwork || !image) return;
    heading.style.setProperty("--cover-heading-shade", ".75");
    let frame = 0;
    const measure = () => {
      try { heading.style.setProperty("--cover-heading-shade", String(headingShade(heading, image, cover))); }
      catch { /* Keep the protective default if image pixels are unavailable. */ }
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(heading); observer?.observe(cover);
    window.addEventListener("resize", schedule);
    image.addEventListener("load", schedule);
    if (image.complete) measure();
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); image.removeEventListener("load", schedule); window.removeEventListener("resize", schedule); };
  }, [artwork]);
  return <div className="reader-cover__heading" ref={ref}>{children}</div>;
}
