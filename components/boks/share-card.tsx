"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Copy, Download } from "lucide-react";
import { ReaderBackIcon as ArrowLeft, ReaderShareIcon as Share2 } from "./reader/reader-icons";
import { Button } from "@/components/ui/button";
import { useReaderPreferences } from "@/components/boks/reader-preferences";
import { bokShareUrl, renderBokPoster, type ShareBok } from "@/components/boks/share-card-export";
import { loadBokSlug } from "@/components/boks/supabase-browser-data";

import { bokCoverStyle } from "./reader/bok-cover-palette";
import { bokArtworkFocus } from "./reader/bok-artwork";

export function ShareCard({ story, artwork, onClose, onShared }: { story: ShareBok; artwork?: string | null; onClose: () => void; onShared?: () => void }) {
  const { t } = useReaderPreferences();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const [posterDownloadUrl, setPosterDownloadUrl] = useState<string | null>(null);
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

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => () => { if (posterDownloadUrl) URL.revokeObjectURL(posterDownloadUrl); }, [posterDownloadUrl]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      onShared?.();
      setStatus(t("Link copied.", "Ссылка скопирована."));
    } catch {
      setShowLink(true);
      setStatus(t("Copy the link below.", "Скопируйте ссылку ниже."));
    }
  }

  async function share() {
    if (!navigator.share) { await copyLink(); return; }
    try { await navigator.share({ title: story.title, url: link }); onShared?.(); }
    catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setShowLink(true);
      setStatus(t("Sharing is unavailable. You can copy the link.", "Не удалось поделиться. Можно скопировать ссылку."));
    }
  }

  async function saveCard() {
    setBusy(true);
    setStatus("");
    try {
      const blob = await renderBokPoster(story, artwork);
      const file = new File([blob], `boks-${story.id}.png`, { type: "image/png" });
      const url = URL.createObjectURL(blob);
      setPosterDownloadUrl(url);
      // Some embedded browsers advertise file sharing but never resolve its
      // promise. The generated PNG remains a usable download in that case.
      setBusy(false);
      setStatus(t("Your card is ready. You can also download the PNG below.", "Карточка готова. Можно скачать PNG по ссылке ниже."));
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: story.title }); onShared?.(); return; }
        catch (error) { if (error instanceof Error && error.name === "AbortError") return; }
      }
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      onShared?.();
      setStatus(t("Card ready to save.", "Карточка готова к сохранению."));
    } catch {
      setStatus(t("Could not create the card. Try again or copy the link.", "Не удалось создать карточку. Попробуйте ещё раз или скопируйте ссылку."));
    } finally { setBusy(false); }
  }

  return (
    <div className="auth-overlay social-overlay" role="dialog" aria-modal="true" aria-label={t("Share bok", "Поделиться боком")}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") onClose();
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
        <div className={`bok-share-poster${artwork && !artworkFailed ? " bok-share-poster--art" : ""}`} style={bokCoverStyle(story.id) as CSSProperties}>
          {/* The real artwork is decorative; title and byline stay selectable. */}
          {artwork && !artworkFailed && <img src={artwork} alt="" style={{ objectPosition: bokArtworkFocus(story.id) }} onError={() => setArtworkFailed(true)} />}
          {(!artwork || artworkFailed) && <span className="bok-share-poster-letter" aria-hidden="true">{story.title.trim().charAt(0)}</span>}
          <span className="bok-share-wordmark">boks</span>
          <div className="bok-share-copy" translate="no"><h1>{story.title}</h1><p>{story.authorName}</p></div>
          <small>{typeof window === "undefined" ? "boks" : window.location.hostname}</small>
        </div>
        <div className="share-controls"><Button onClick={() => void share()}><Share2 />{t("Share bok", "Поделиться")}</Button><div><Button variant="outline" onClick={() => void copyLink()}><Copy />{t("Copy link", "Ссылка")}</Button><Button variant="outline" onClick={() => void saveCard()} disabled={busy}><Download />{busy ? t("Creating…", "Создаём…") : t("Save card", "Сохранить")}</Button></div></div>
        {showLink && <input className="share-link-fallback" aria-label={t("Bok link", "Ссылка на бок")} value={link} readOnly onFocus={(event) => event.currentTarget.select()} />}
        {posterDownloadUrl && <a className="share-download-link" href={posterDownloadUrl} download={`boks-${story.id}.png`} onClick={() => onShared?.()}>{t("Download PNG", "Скачать PNG")}</a>}
        {status && <p className="social-status" role="status">{status}</p>}
      </section>
    </div>
  );
}
