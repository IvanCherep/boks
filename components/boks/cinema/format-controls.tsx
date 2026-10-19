"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ChevronRight, Pause, RotateCw, X } from "lucide-react";
import { ReaderBackIcon as ArrowLeft, ReaderBookIcon as BookOpen, ReaderMoreIcon as MoreHorizontal, ReaderPlayIcon as Play, ReaderSettingsIcon as SlidersHorizontal } from "@/components/boks/reader/reader-icons";
import { useReaderPreferences } from "@/components/boks/reader-preferences";
import { formatClock } from "@/components/boks/cinema/scene-plan";

const playerClock = (seconds: number) => formatClock(seconds).replace(/^0(?=\d:)/, "");

export type FormatPlaybackState = { playing: boolean; progress: number; ended: boolean };

/** Fixed decorative profile, not an analysis of the recording's amplitude. */
const waveHeights = Array.from({ length: 84 }, (_, index) => {
  const x = index / 83;
  const phrases = [[.08, .045, .75], [.22, .048, .9], [.39, .052, .58], [.56, .058, .96], [.74, .044, .72], [.91, .038, .5]];
  const envelope = phrases.reduce((sum, [centre, width, amplitude]) => sum + amplitude * Math.exp(-Math.pow((x - centre) / width, 2)), 0);
  const articulation = .78 + .16 * Math.sin(index * 2.4) + .06 * Math.cos(index * 4.1);
  return Math.max(.07, Math.min(1, .07 + envelope * articulation));
});

export function FormatControls({
  title, byline, artwork, elapsed, total, playing, stepSeconds,
  onToggle, onSeek, onRestart, onReadText, onClose, voice, onVoiceChange,
  music, onMusicChange, onMenuChange, hidden = false, moments = [], start = false, status = null,
}: {
  title: string; byline: string; artwork?: string;
  elapsed: number; total: number; playing: boolean; stepSeconds: 5 | 15;
  onToggle: () => void; onSeek: (seconds: number) => void; onRestart: () => void;
  onReadText: () => void; onClose: () => void; voice: number; onVoiceChange: (value: number) => void;
  music?: number; onMusicChange?: (value: number) => void;
  onMenuChange: (open: boolean) => void; hidden?: boolean; moments?: readonly number[];
  start?: boolean; status?: "loading" | "error" | null;
}) {
  const { t } = useReaderPreferences();
  const [menu, setMenu] = useState<"playback" | "sound" | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dragStart = useRef<number | null>(null);
  const closeMenu = () => { setMenu(null); onMenuChange(false); trigger.current?.focus(); };
  const resume = () => { closeMenu(); if (!playing) onToggle(); };

  useEffect(() => {
    if (!menu) return;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [menu]);

  const fraction = total > 0 ? Math.min(1, Math.max(0, elapsed / total)) : 0;
  return <>
    <header className={`format-top${hidden || menu ? " is-hidden" : ""}`}>
      <button type="button" className="format-top__back" aria-label={t("Back", "Назад")} onClick={onClose}><ArrowLeft /></button>
      <span className="format-top__title" translate="no">{title}</span>
      <button ref={trigger} type="button" className="format-menu-trigger" aria-label={t("Playback", "Воспроизведение")} onClick={() => {
        setMenu("playback"); onMenuChange(true);
      }}><MoreHorizontal /></button>
    </header>
    {status ? null : start ? <div className="format-start">
      <button type="button" className="format-start__read" onClick={onReadText}><BookOpen /><span>{t("Read text", "Читать текст")}</span></button>
      <div className="format-start__action"><span aria-hidden="true">{t("Play", "Слушать")}</span><button type="button" className="format-bookmark" onClick={onToggle} aria-label={t("Play", "Воспроизвести")}><Play /></button></div>
    </div> : <div className={`format-controls${hidden || menu ? " is-hidden" : ""}`} style={{ "--played": fraction } as CSSProperties}>
      <div className="format-wave" data-waveform="decorative">
        <span className="format-wave__bars" aria-hidden="true">{waveHeights.map((height, index) => <i key={index} style={{ "--h": height } as CSSProperties} />)}</span>
        <span className="format-wave__bars format-wave__bars--played" aria-hidden="true">{waveHeights.map((height, index) => <i key={index} style={{ "--h": height } as CSSProperties} />)}</span>
        <span className="format-wave__cursor" aria-hidden="true" />
        {moments.map((at) => <span key={at} className="format-wave__moment" style={{ left: `${at / total * 100}%` }} aria-hidden="true" />)}
        <input type="range" min={0} max={total || 1} step={0.1} value={Math.min(elapsed, total || 1)}
          aria-label={t("Playback position", "Позиция воспроизведения")} aria-valuetext={`${playerClock(elapsed)} / ${playerClock(total)}`}
          onChange={(event) => onSeek(Number(event.target.value))}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault(); onSeek(elapsed + (event.key === "ArrowLeft" ? -stepSeconds : stepSeconds));
          }} />
      </div>
      <div className="format-controls__time"><span><output>{playerClock(elapsed)}</output><span> / {playerClock(total)}</span></span>
        <div className="format-controls__steps">
          <SeekButton seconds={stepSeconds} onClick={() => onSeek(elapsed - stepSeconds)} />
          <SeekButton seconds={stepSeconds} forward onClick={() => onSeek(elapsed + stepSeconds)} />
        </div>
      </div>
      <button type="button" className="format-bookmark" onClick={onToggle} aria-label={playing ? t("Pause", "Пауза") : t("Play", "Воспроизвести")}>
        {playing ? <Pause className="size-6" /> : <Play className="size-6" />}
      </button>
    </div>}
    {menu && <div className="format-menu-layer" onClick={closeMenu}>
      <div ref={panel} className="format-menu" role="dialog" aria-modal="true" aria-label={menu === "sound" ? t("Sound", "Звук") : t("Playback", "Воспроизведение")}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") { event.preventDefault(); closeMenu(); }
          if (event.key === "Tab") {
            const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]')];
            const first = focusable[0]; const last = focusable.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
        <button type="button" className="format-menu__grip" aria-label={t("Close playback", "Закрыть воспроизведение")} onClick={closeMenu}
          onPointerDown={(event) => { dragStart.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerUp={(event) => { if (dragStart.current !== null && event.clientY - dragStart.current > 55) closeMenu(); dragStart.current = null; }} />
        {menu === "sound" ? <>
          <div className="format-menu__sound-header">
            <button type="button" onClick={() => setMenu("playback")} aria-label={t("Back to playback", "К воспроизведению")}><ArrowLeft /></button>
            <h2>{t("Sound", "Звук")}</h2>
            <button type="button" className="format-menu__close" onClick={closeMenu} aria-label={t("Close playback", "Закрыть воспроизведение")}><X /></button>
          </div>
          <p className="format-menu__context" translate="no">{title}</p>
          <div className="format-menu__mix">
            <VolumeControl label={t("Voice", "Голос")} value={voice} onChange={onVoiceChange} />
            {music !== undefined && onMusicChange && <VolumeControl label={t("Music", "Музыка")} value={music} onChange={onMusicChange} />}
          </div>
          <button type="button" className="format-menu__resume format-menu__resume--sound" onClick={resume}>{t("Resume", "Продолжить")} <Play /></button>
        </> : <>
        <div className="format-menu__header">
          {/* The prepared artwork has its own static asset size. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {artwork && <img src={artwork} alt="" />}
          <div><h2 translate="no">{title}</h2><p translate="no">{byline}</p></div>
          <button type="button" className="format-menu__close" onClick={closeMenu} aria-label={t("Close playback", "Закрыть воспроизведение")}><X /></button>
        </div>
          <div className="format-menu__tiles">
            <button type="button" onClick={() => setMenu("sound")}><span className="format-menu__glyph"><SlidersHorizontal /></span><span>{t("Sound", "Звук")}<ChevronRight /></span></button>
            <button type="button" onClick={onReadText}><span className="format-menu__glyph"><BookOpen /></span><span>{t("Read text", "Читать текст")}<ChevronRight /></span></button>
          </div>
          <button type="button" className="format-menu__restart" onClick={() => { closeMenu(); onRestart(); }}><RotateCw />{t("Restart", "Сначала")} <span>0:00</span></button>
          <button type="button" className="format-menu__resume" onClick={resume}>{t("Resume", "Продолжить")} <Play /></button>
        </>}
      </div>
    </div>}
  </>;
}

function VolumeControl({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const id = useId();
  const percent = Math.round(value * 100);
  return <div className="format-mix">
    <div className="format-mix__label"><label htmlFor={id}>{label}</label><span><output htmlFor={id}>{percent}</output><small>%</small></span></div>
    <div className="format-mix__track" style={{ "--level": `${percent}%` } as CSSProperties}>
      <span className="format-mix__fill" aria-hidden="true" /><span className="format-mix__thumb" aria-hidden="true" />
      <input id={id} aria-label={label} type="range" min={0} max={1} step={0.01} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  </div>;
}

function SeekButton({ seconds, forward = false, onClick }: { seconds: number; forward?: boolean; onClick: () => void }) {
  const { t } = useReaderPreferences();
  return <button type="button" className="format-seek" onClick={onClick} aria-label={t(`${forward ? "Forward" : "Back"} ${seconds} seconds`, `${forward ? "Вперёд" : "Назад"} на ${seconds} секунд`)}>
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g transform={forward ? "translate(32 0) scale(-1 1)" : undefined}><path d="M8.58 9.58A10.5 10.5 0 1 1 5.5 17M8.58 4.58v5h5" /></g>
      <text x="16" y="21" textAnchor="middle" stroke="none" fill="currentColor">{seconds}</text>
    </svg>
  </button>;
}

/** Loading and failure stay in the current illustration and retain a real text exit. */
export function FormatStatus({ error = false, onRetry, onReadText }: {
  error?: boolean; onRetry?: () => void; onReadText: () => void;
}) {
  const { t } = useReaderPreferences();
  return <section className="format-status" role={error ? "alert" : "status"}>
    <h2>{error ? t("Audio unavailable", "Аудио недоступно") : t("Loading audio…", "Загружаем аудио…")}</h2>
    {error ? <p>{t("Check your connection and try again.", "Проверьте подключение и попробуйте снова.")}</p> : <div className="format-status__loading" aria-hidden="true"><span /></div>}
    <div className="format-status__actions">
      {error && onRetry && <button type="button" className="format-status__retry" onClick={onRetry}>{t("Try again", "Попробовать снова")}</button>}
      <button type="button" className="format-status__read" onClick={onReadText}>{t("Read text", "Читать текст")}</button>
    </div>
  </section>;
}
