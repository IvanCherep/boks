"use client";

import { useEffect, useRef } from "react";
import { getBokCoverAnimation } from "./bok-artwork";

/** Motion belongs to the visible cover, never to thumbnails or a reading format. */
export function CoverArtwork({ bokId, artwork, active }: { bokId: string; artwork: string; active: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const animation = getBokCoverAnimation(bokId);
  useEffect(() => {
    const video = ref.current;
    if (!video || !animation) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let failed = false;
    const update = () => {
      if (active && visible && !document.hidden && !motion.matches && !failed) {
        // With reduced motion or an unshown cover even the video request is omitted.
        if (!video.getAttribute("src")) video.src = animation;
        void video.play().catch(() => { /* Autoplay denial leaves the still cover. */ });
      } else {
        video.pause();
        if (motion.matches) video.dataset.ready = "false";
      }
    };
    const playing = () => { video.dataset.ready = "true"; };
    const error = () => { failed = true; video.dataset.ready = "false"; video.pause(); };
    // A zero threshold can stay intersecting when Read leaves the cover exactly
    // against the viewport edge, so cross a positive threshold before that edge.
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= .01;
      update();
    }, { threshold: .01 });
    observer.observe(video);
    video.addEventListener("playing", playing);
    video.addEventListener("error", error);
    document.addEventListener("visibilitychange", update);
    motion.addEventListener("change", update);
    return () => {
      observer.disconnect();
      video.pause();
      video.removeEventListener("playing", playing);
      video.removeEventListener("error", error);
      document.removeEventListener("visibilitychange", update);
      motion.removeEventListener("change", update);
    };
  }, [active, animation]);
  return <>
    <img className="reader-cover__art" src={artwork} alt="" draggable={false} />
    {animation && <video ref={ref} className="reader-cover__art reader-cover__motion" muted loop playsInline preload="none" aria-hidden="true" />}
  </>;
}
