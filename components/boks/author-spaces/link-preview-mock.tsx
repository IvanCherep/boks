"use client";

import { sharePitch } from "@/lib/boks/share-preview";
import { authorShareLabel } from "@/lib/boks/share-link";

/**
 * How a page's link looks when it is sent: the card a messenger builds from
 * the page's preview tags (`app/a/[handle]/page.tsx`). Drawn from the same
 * values, so what the team and the author see here is what a reader gets:
 * the still card everywhere, and the moving one where it is played
 * (Telegram), beside it.
 */
export function LinkPreviewMock({
  handle,
  name,
  card,
  video,
  labels,
}: {
  handle: string;
  name: string;
  card: string | null;
  video: string | null;
  labels: { still: string; moving: string; noCard: string; site: string };
}) {
  const title = name && !name.startsWith("@") ? `${name} · @${handle}` : `@${handle} · boks`;
  // The link as it is sent: on go.tryboks.com, which messengers abroad can reach.
  const url = authorShareLabel(handle);
  if (!card && !video) return <p className="lpm-empty">{labels.noCard}</p>;
  return (
    <div className="lpm">
      {card && (
        <figure className="lpm-item">
          <figcaption>{labels.still}</figcaption>
          <div className="lpm-bubble lpm-bubble--light">
            <span className="lpm-url">{url}</span>
            <span className="lpm-card">
              <span className="lpm-site">{labels.site}</span>
              <strong>{title}</strong>
              <span className="lpm-desc">{sharePitch.ru}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={card} alt="" width={1200} height={630} />
            </span>
          </div>
        </figure>
      )}
      {video && (
        <figure className="lpm-item">
          <figcaption>{labels.moving}</figcaption>
          <div className="lpm-bubble lpm-bubble--dark">
            <span className="lpm-url">{url}</span>
            <span className="lpm-card">
              <span className="lpm-site">{labels.site}</span>
              <strong>{title}</strong>
              <span className="lpm-desc">{sharePitch.ru}</span>
              <video src={video} poster={card ?? undefined} autoPlay muted loop playsInline width={960} height={504} />
            </span>
          </div>
        </figure>
      )}
    </div>
  );
}
