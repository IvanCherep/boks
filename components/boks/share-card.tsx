"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, SlidersHorizontal } from "lucide-react";
import "@/app/share-kit.css";
import { ReaderBackIcon as ArrowLeft } from "./reader/reader-icons";
import { Button } from "@/components/ui/button";
import { useReaderPreferences } from "@/components/boks/reader-preferences";
import { bokShareUrl, type ShareBok } from "@/components/boks/share-card-export";
import { loadBokSlug } from "@/components/boks/supabase-browser-data";
import { ShareLinkPair } from "@/components/boks/share/share-link-pair";
import { russianShareUrl } from "@/lib/boks/share-link";
import { canShareKitFile, KitOptions, KitPreview, useKitCard } from "@/components/boks/story-kit/kit-editor";
import { kitWorkFromStory } from "@/components/boks/story-kit/kit-subjects";
import { shareToStory } from "@/components/boks/story-kit/kit-share";

/**
 * "Share bok": the link, and a picture of the bok drawn by the same engine as
 * the author's "For social media" (`docs/story-kit.md`). The picture is ready
 * as the sheet opens; its choices (format, style, frame, lines) stay folded
 * behind one quiet button, so a reader who only wants the link sees no more
 * than before.
 */
type ShareStory = ShareBok & { authorHandle?: string; body?: string };

export function ShareCard({ story, artwork, onClose, onShared }: { story: ShareStory; artwork?: string | null; onClose: () => void; onShared?: () => void }) {
  const { t } = useReaderPreferences();
  const [status, setStatus] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);
  const [tuning, setTuning] = useState(false);
  const [offerDownload, setOfferDownload] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  // Asked for as the sheet opens, not on the tap: a share sheet must open in
  // the tap itself, with no wait in between. A tap before the answer shares
  // the id link, which opens the same bok.
  const [slug, setSlug] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadBokSlug(story.id).then((value) => { if (live) setSlug(value); });
    return () => { live = false; };
  }, [story.id]);
  const link = typeof window === "undefined" ? "" : bokShareUrl({ id: story.id, slug }, window.location.origin);

  const subject = useMemo(() => kitWorkFromStory(story, artwork ?? null), [story, artwork]);
  const kit = useKitCard(subject, story.authorHandle ?? "");
  const canShareFile = canShareKitFile(kit.file);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, []);

  async function copyLink(text = link) {
    try {
      await navigator.clipboard.writeText(text);
      onShared?.();
      setStatus(t("Link copied.", "Ссылка скопирована."));
    } catch {
      setShowLink(true);
      setStatus(t("Copy the link below.", "Скопируйте ссылку ниже."));
      return false;
    }
  }

  function download() {
    if (!kit.picture) return;
    const anchor = document.createElement("a");
    anchor.href = kit.picture.url;
    anchor.download = kit.fileName;
    anchor.click();
    onShared?.();
    setStatus(t("The picture is saved.", "Картинка сохранена."));
  }

  async function sharePicture() {
    if (!kit.file || !kit.ready) return;
    if (!canShareFile) { download(); return; }
    // Some embedded browsers advertise file sharing but never answer: the download stays at hand.
    setOfferDownload(true);
    // The link goes to the clipboard in the same tap, for the story's "Link" sticker.
    const { outcome, copied } = await shareToStory(kit.file, russianShareUrl(link), { share: (data) => navigator.share(data), clipboard: navigator.clipboard });
    if (outcome === "shared") onShared?.();
    if (outcome === "failed") setStatus(t("The phone did not open its menu. Save the picture below.", "Телефон не открыл меню. Сохраните картинку по ссылке ниже."));
    else if (copied) setStatus(t("The link is copied: in a story, paste it into the “Link” sticker.", "Ссылка скопирована: в сторис вставьте её в стикер «Ссылка»."));
  }

  return (
    <div className="auth-overlay social-overlay" role="dialog" aria-modal="true" aria-label={t("Share bok", "Поделиться боком")}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") { if (tuning) setTuning(false); else onClose(); }
        if (event.key === "Tab") {
          const nodes = panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, a[href]');
          if (!nodes?.length) return;
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }} onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()}>
      <section className="social-page share-page" ref={panelRef}>
        <header className="social-page-header"><Button size="icon" variant="ghost" onClick={onClose} aria-label={t("Back", "Назад")}><ArrowLeft /></Button><span>{t("Share bok", "Поделиться боком")}</span><span /></header>
        <div className="share-kit">
          <KitPreview kit={kit} />
          <button type="button" className="share-kit-toggle" aria-haspopup="dialog" onClick={() => { setStatus(""); panelRef.current?.scrollTo(0, 0); setTuning(true); }}>
            <SlidersHorizontal aria-hidden="true" />
            {t("Change the picture", "Изменить картинку")}
          </button>
        </div>
        <div className="share-controls">
          <ShareLinkPair url={link} share={{ title: story.title, onShared }} onCopy={async (text) => { const ok = await copyLink(text); if (ok === false) setFallbackLink(text); return ok; }} />
          <Button variant="outline" onClick={() => void sharePicture()} disabled={!kit.ready}>
            <Download />{canShareFile ? t("Share the picture", "Поделиться картинкой") : t("Save the picture", "Сохранить картинку")}
          </Button>
        </div>
        {showLink && <input className="share-link-fallback" aria-label={t("Bok link", "Ссылка на бок")} value={fallbackLink ?? link} readOnly onFocus={(event) => event.currentTarget.select()} />}
        {offerDownload && kit.picture && <a className="share-download-link" href={kit.picture.url} download={kit.fileName} onClick={() => onShared?.()}>{t("Download the picture", "Скачать картинку")}</a>}
        {status && <p className="social-status" role="status">{status}</p>}
        {tuning && (
          // The choices get a screen of their own over the sheet: the link buttons stay out of sight while choosing.
          <div className="share-kit-screen" role="dialog" aria-label={t("The picture", "Картинка")}>
            <header className="social-page-header"><Button size="icon" variant="ghost" onClick={() => setTuning(false)} aria-label={t("Back", "Назад")}><ArrowLeft /></Button><span>{t("The picture", "Картинка")}</span><span /></header>
            <KitPreview kit={kit} />
            <div className="share-kit-options"><KitOptions kit={kit} onNotice={setStatus} /></div>
            {status && <p className="social-status" role="status">{status}</p>}
            <div className="share-kit-done"><Button onClick={() => { setStatus(""); setTuning(false); }}>{t("Done", "Готово")}</Button></div>
          </div>
        )}
      </section>
    </div>
  );
}
