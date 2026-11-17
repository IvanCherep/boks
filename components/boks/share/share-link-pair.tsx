"use client";

import { useState } from "react";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";
import { russianShareUrl } from "@/lib/boks/share-link";

/**
 * Two ways to copy one link, side by side: for social networks in Russia
 * (tryboks.com, which their preview bots reach) and for international ones
 * (go.tryboks.com, which Telegram and the rest of the world reach). Both
 * build the same preview; only the address differs (`lib/boks/share-link.ts`).
 * Networks are named only where naming them is safe.
 */

export type ShareAudience = "ru" | "world";

const words = defineMessages(
  {
    copyFor: "Copy the link for",
    sendFor: "Send the link to",
    ru: "Russian social networks",
    ruHint: "VK, OK, Dzen",
    world: "International",
    worldHint: "Telegram and the rest",
    copied: "Copied",
  },
  {
    ru: {
      copyFor: "Скопировать ссылку для",
      sendFor: "Отправить ссылку для",
      ru: "Российских соцсетей",
      ruHint: "ВКонтакте, ОК, Дзен",
      world: "Международных соцсетей",
      worldHint: "Telegram и все остальные",
      copied: "Скопировано",
    },
  }
);

export function shareUrlFor(url: string, audience: ShareAudience) {
  return audience === "ru" ? russianShareUrl(url) : url;
}

export function ShareLinkPair({
  url,
  onCopy,
  className,
  caption = true,
  share,
}: {
  /** The go. link, as `bokShareUrl` / `authorShareUrl` give it. */
  url: string;
  /** Copies itself when absent; with it, the caller copies (and says so), returning false when it could not. */
  onCopy?: (link: string, audience: ShareAudience) => boolean | void | Promise<boolean | void>;
  className?: string;
  caption?: boolean;
  /**
   * Where the phone has a share sheet, each button opens it with its own link
   * (there is no third, neutral "Share": the two links differ); elsewhere it copies.
   */
  share?: { title: string; text?: string; onShared?: () => void };
}) {
  const t = useMessages(words);
  const [done, setDone] = useState<ShareAudience | null>(null);
  // No clipboard (an old browser, a denied permission): the link to copy by hand.
  const [manual, setManual] = useState<string | null>(null);

  async function copy(audience: ShareAudience) {
    const link = shareUrlFor(url, audience);
    if (share && typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: share.title, text: share.text, url: link });
        share.onShared?.();
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        // The sheet failed: copying still works.
      }
    }
    if (onCopy) {
      if ((await onCopy(link, audience)) === false) return;
    } else {
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        setManual(link);
        return;
      }
    }
    setManual(null);
    setDone(audience);
    window.setTimeout(() => setDone((now) => (now === audience ? null : now)), 2200);
  }

  const button = (audience: ShareAudience) => (
    <button type="button" className={`share-pair__btn share-pair__btn--${audience}${done === audience ? " is-done" : ""}`} onClick={() => void copy(audience)}>
      {share
        ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 4 19 8-19 8 4-8zm4 8h15" /></svg>
        : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7V3h12v14h-4M3 7h14v14H3z" /></svg>}
      <strong>{done === audience ? t.copied : audience === "ru" ? t.ru : t.world}</strong>
      <small>{audience === "ru" ? t.ruHint : t.worldHint}</small>
    </button>
  );

  return (
    <div className={`share-pair${className ? ` ${className}` : ""}`} role="group" aria-label={share ? t.sendFor : t.copyFor}>
      {caption && <span className="share-pair__caption">{share ? t.sendFor : t.copyFor}</span>}
      <div className="share-pair__row">
        {button("ru")}
        {button("world")}
      </div>
      {manual && <input className="share-pair__manual" readOnly value={manual} aria-label={t.copyFor} autoFocus onFocus={(event) => event.currentTarget.select()} />}
    </div>
  );
}
