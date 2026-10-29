"use client";

import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { ReaderNextIcon as ArrowRight, ReaderHeartIcon as Heart, ReaderCommentsIcon as MessageCircle, ReaderShareIcon as Share2 } from "./reader/reader-icons";
import { aftertasteTags, type AftertasteTag } from "@/lib/boks/contracts";
import { useReaderPreferences } from "@/components/boks/reader-preferences";
import { bokCoverStyle } from "./reader/bok-cover-palette";
import { bokArtworkFocus } from "./reader/bok-artwork";
import { formatCompactCount } from "./client-format";

export type FinaleActions = {
  liked: boolean;
  likeCount: number;
  commentCount: number;
  onLike: () => void;
  onShare: () => void;
  onComments?: () => void;
  onNext: () => void;
  nextBok?: { id: string; title: string; authorName?: string; artwork?: string | null };
  nextLabel?: string;
  /** Editable until leaving the bok. The reader owns the one final event. */
  aftertaste?: AftertasteTag[];
  aftertasteSubmitted?: boolean;
  onAftertaste: (tags: AftertasteTag[]) => void;
  onReached?: () => void;
  onInteract?: () => void;
};

/** One ending for HTML text and both reading formats. No completion button. */
export function ReadingFinale({ actions, onAgain, title, byline, artwork, inline = false }: {
  actions?: FinaleActions;
  onAgain: () => void;
  title?: string;
  byline?: string;
  artwork?: string | null;
  inline?: boolean;
}) {
  const { t } = useReaderPreferences();
  const [picked, setPicked] = useState<AftertasteTag[]>([]);
  const selected = actions?.aftertaste ?? picked;
  const reached = useRef(actions?.onReached);
  // Inline endings are in the scroll document before they are reached.
  useEffect(() => { if (!inline) reached.current?.(); }, [inline]);
  const labels: Record<AftertasteTag, string> = {
    smiled: t("Made me smile", "Улыбнуло"), moved: t("Moved me", "Тронуло"),
    surprised: t("Surprised me", "Удивило"), pondering: t("Want to think", "Хочется подумать"),
  };
  return <section className={`bok-finale${inline ? " bok-finale--inline" : " bok-finale--immersive"}`} aria-label={t("After reading", "После чтения")} onPointerDown={actions?.onInteract} onFocus={actions?.onInteract}>
    {!inline && artwork && <img className="bok-finale__backdrop" src={artwork} alt="" />}
    {!inline && <div className="bok-finale__heading">
      {title && <h2>{title}</h2>}{byline && <p>{byline}</p>}<span className="bok-endmark" aria-hidden="true">b.</span>
    </div>}
    <div className="bok-finale__content">
      <h3>{t("What stayed with you?", "Что осталось с вами?")}</h3>
      <div className="aftertaste-grid">
        {aftertasteTags.map(tag => <button key={tag} type="button" className="aftertaste-choice" disabled={actions?.aftertasteSubmitted} aria-pressed={selected.includes(tag)} onClick={() => {
          const next = selected.includes(tag) ? selected.filter(value => value !== tag) : [...selected, tag];
          setPicked(next); actions?.onAftertaste(next);
        }}>
          <img src={`/design/reaction-${tag}-v44.png`} alt="" width="48" height="48" loading="lazy" />
          <span>{labels[tag]}</span>{selected.includes(tag) && <Check className="aftertaste-check" size={14} />}
        </button>)}
      </div>
      {actions?.aftertasteSubmitted && <p className="aftertaste-saved">{t("Selected for this reading", "Выбрано для этого чтения")}</p>}
      <div className="bok-finale__actions">
        {actions && <>
          <button type="button" className="reader-counted-action" aria-label={`${t(actions.liked ? "Unlike bok" : "Like bok", actions.liked ? "Убрать отметку нравится" : "Нравится")}, ${actions.likeCount}`} aria-pressed={actions.liked} onClick={actions.onLike}><Heart size={21} fill={actions.liked ? "currentColor" : "none"} /><span className="reader-action-count" aria-hidden="true">{formatCompactCount(actions.likeCount)}</span></button>
          {actions.onComments && <button type="button" className="reader-counted-action" aria-label={`${t("Comments", "Комментарии")}, ${actions.commentCount}`} onClick={actions.onComments}><MessageCircle size={21} /><span className="reader-action-count" aria-hidden="true">{formatCompactCount(actions.commentCount)}</span></button>}
          <button type="button" aria-label={t("Share", "Поделиться")} onClick={actions.onShare}><Share2 size={21} /></button>
        </>}
        <button type="button" aria-label={t(inline ? "Read again" : "Play again", inline ? "Прочитать снова" : "Послушать снова")} onClick={onAgain}><RotateCcw size={21} /></button>
      </div>
      {actions && <button type="button" className="bok-next-preview" onClick={actions.onNext}>
        {actions.nextBok?.artwork ? <img src={actions.nextBok.artwork} alt="" width="64" height="64" loading="lazy" style={{ objectPosition: bokArtworkFocus(actions.nextBok.id) }} /> : actions.nextBok && <span className="bok-next-preview__type" style={bokCoverStyle(actions.nextBok.id) as React.CSSProperties} aria-hidden="true">{actions.nextBok.title.charAt(0)}</span>}
        <span className="bok-next-preview__copy"><small>{actions.nextBok ? t("UP NEXT", "ДАЛЬШЕ") : actions.nextLabel ?? t("Back to the feed", "Вернуться в ленту")}</small>
          {actions.nextBok && <><strong>{actions.nextBok.title}</strong><span>{actions.nextBok.authorName}</span></>}
        </span><span className="bok-next-preview__arrow"><ArrowRight size={22} /></span>
      </button>}
    </div>
  </section>;
}
