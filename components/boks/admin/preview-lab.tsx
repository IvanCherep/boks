"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";
import { shareOrigin } from "@/lib/boks/share-link";
import { previewLabFilePath, previewLabVariants } from "@/lib/boks/preview-lab";

const words = defineMessages(
  {
    title: "Preview lab",
    lead: "Temporary. Each link opens Алексей Прохоров's page and previews with its own card. Post them where you want to test; the go. link is the one that previews in Telegram. Messengers cache a preview per address: to re-check after a change, add ?v=2.",
    copy: "Copy",
    copied: "Copied",
    open: "Open card",
    video: "video",
  },
  {
    ru: {
      title: "Лаборатория превью",
      lead: "Временно. Каждая ссылка открывает страницу Алексея Прохорова, а в превью показывает свою карточку. Публикуйте там, где хотите проверить; в Telegram превью есть только у ссылки go. Мессенджеры запоминают превью по адресу: чтобы перепроверить после правки, допишите ?v=2.",
      copy: "Копировать",
      copied: "Скопировано",
      open: "Открыть карточку",
      video: "видео",
    },
  }
);

/** Studio -> Links: the hidden `/p/<slug>` addresses of the preview lab (`lib/boks/preview-lab.ts`). */
export function PreviewLabPanel() {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window === "undefined" ? "https://tryboks.com" : window.location.origin;
  const share = shareOrigin(origin).replace(/\/+$/, "");

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      window.setTimeout(() => setCopied((current) => (current === url ? null : current)), 2000);
    } catch {
      // The link is on screen to copy by hand.
    }
  }

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-[var(--border)] p-4">
        <h2 className="text-xl font-semibold tracking-normal">{t.title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">{t.lead}</p>
      </div>
      <ul className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
        {previewLabVariants.map((variant) => {
          const image = previewLabFilePath(variant.image.file);
          const links = [`${share}/p/${variant.slug}`, `${origin.replace(/\/+$/, "")}/p/${variant.slug}`].filter(
            (url, index, all) => all.indexOf(url) === index
          );
          return (
            <li key={variant.slug} className="grid gap-3 rounded-xl border border-[var(--border)] p-3">
              <div className="flex h-56 items-center justify-center overflow-hidden rounded-lg bg-[var(--muted)]">
                {image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                )}
              </div>
              <div>
                <div className="font-medium">{variant.name[language]}</div>
                <div className="text-xs text-[var(--muted-foreground)]">
                  {variant.image.width}×{variant.image.height} · {variant.image.type.replace("image/", "")} · {variant.image.kb} KB
                  {variant.video ? ` + ${t.video} mp4 · ${variant.video.kb} KB` : ""}
                </div>
                <p className="mt-1 text-sm">{variant.note[language]}</p>
              </div>
              <div className="grid gap-2">
                {links.map((url) => (
                  <div key={url} className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-[var(--muted)] px-2 py-1 text-xs">{url}</code>
                    <Button type="button" size="sm" variant="outline" onClick={() => void copy(url)}>
                      <Copy className="size-4" /> {copied === url ? t.copied : t.copy}
                    </Button>
                  </div>
                ))}
                {image && (
                  <a className="author-account-link text-xs" href={variant.video ? (previewLabFilePath(variant.video.file) ?? image) : image} target="_blank" rel="noreferrer">
                    {t.open}
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
