"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@/app/daily.css";
import { formatReaderBody } from "@/components/boks/reader-text";
import { useMessages } from "@/components/boks/ui-language";
import { minAnswersForShares, optionLabels, wholeShares } from "@/lib/boks/daily/passage";
import { readableBoksError } from "@/lib/boks/errors";
import { answerAuthorGame, loadAuthorGame, type AuthorGame, type AuthorGameResult } from "./data";
import { dailyMessages } from "./messages";

/**
 * You → Settings → Guess the author. One short text a day, whole, with its
 * stanzas; three names under it; one confirmed answer. The title and the
 * author come only with the answer - the server does not send them before.
 */
export function AuthorGamePage({ signedIn, onSignIn, onOpenWork, onAnswered }: {
  signedIn: boolean;
  onSignIn: () => void;
  onOpenWork: (bokId: string) => void;
  /** Today's issue is answered: the "New text" mark can go. */
  onAnswered?: () => void;
}) {
  const words = useMessages(dailyMessages);
  const [game, setGame] = useState<AuthorGame | null>(null);
  const [failed, setFailed] = useState("");
  const [choice, setChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AuthorGameResult | null>(null);
  const [confirmReveal, setConfirmReveal] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setFailed("");
    try {
      const next = await loadAuthorGame();
      setGame(next);
      if (next.status === "answered" && next.result) {
        setResult(next.result);
        onAnswered?.();
      }
    } catch (error) {
      setFailed(readableBoksError(error, words.gameFailed));
    }
  }, [onAnswered, words.gameFailed]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const blocks = useMemo(() => game && game.status !== "none" ? formatReaderBody(game.text) : [], [game]);
  const labels = useMemo(() => game && game.status !== "none" ? optionLabels(game.options) : [], [game]);

  async function answer(value: number | null) {
    if (!game || game.status === "none" || busy) return;
    if (!signedIn) { onSignIn(); return; }
    setBusy(true);
    setFailed("");
    try {
      const next = await answerAuthorGame(game.date, value);
      setResult(next);
      onAnswered?.();
      requestAnimationFrame(() => {
        const page = resultRef.current?.closest(".social-page");
        page?.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        resultRef.current?.focus({ preventScroll: true });
      });
    } catch (error) {
      setFailed(readableBoksError(error, words.gameFailed));
    } finally {
      setBusy(false);
      setConfirmReveal(false);
    }
  }

  if (failed && !game) return <div className="daily-game"><h1 className="social-display">{words.guessAuthor}</h1><p className="social-note" role="alert">{failed}</p><button type="button" className="daily-link" onClick={() => void load()}>{words.tryAgain}</button></div>;
  if (!game) return <div className="daily-game"><h1 className="social-display">{words.guessAuthor}</h1><p className="social-note" role="status">…</p></div>;
  if (game.status === "none") return <div className="daily-game"><h1 className="social-display">{words.guessAuthor}</h1><div className="daily-game__none"><span aria-hidden="true">?</span><p>{words.noIssue}</p></div></div>;

  if (result) {
    const shares = wholeShares(result.counts);
    const total = result.counts.reduce((sum, count) => sum + count, 0);
    const [first, ...rest] = result.authorName.trim().split(/\s+/);
    return <div className="daily-game daily-game--result" ref={resultRef} tabIndex={-1}>
      <h1 className="daily-game__author" translate="no">{rest.length ? <>{first}<br />{rest.join(" ")}</> : first}</h1>
      <p className={`daily-game__verdict${result.correct ? " is-right" : ""}`}>
        {result.revealed ? words.revealed : result.correct ? words.youGuessed : words.youMissed(labels[result.choice ?? 0])}
      </p>
      {result.title && <p className="daily-game__title" translate="no">«{result.title}»</p>}
      {total >= minAnswersForShares ? <div className="daily-shares">
        {game.options.map((name, index) => <div key={name} className={`daily-share${index === result.correctIndex ? " is-correct" : ""}${index === result.choice ? " is-mine" : ""}`}>
          <span className="daily-share__name" translate="no">{labels[index]}{index === result.choice && !result.revealed && <small>{words.yourChoice}</small>}</span>
          <span className="daily-share__bar" aria-hidden="true"><i style={{ "--share": `${shares[index]}%` } as React.CSSProperties} /></span>
          <span className="daily-share__value">{shares[index]}%</span>
        </div>)}
        <p className="daily-note daily-note--left">{words.answers(total)}</p>
      </div> : <div className="daily-shares__few" aria-hidden="true" />}
      {result.bokId && <button type="button" className="daily-button daily-button--outline" onClick={() => onOpenWork(result.bokId!)}>{words.openWork}</button>}
      <p className="daily-game__tomorrow">{words.newTextTomorrow}</p>
    </div>;
  }

  return <div className="daily-game">
    <h1 className="social-display daily-game__heading">{words.guessAuthor}</h1>
    <div className={`daily-game__text story-copy${blocks[0]?.kind !== "verse" ? " story-copy--prose" : ""}`} lang="und" translate="no">
      {blocks.map((block, index) => <p key={index} className={block.kind === "verse" ? "story-verse" : ""}>{block.lines.join("\n")}</p>)}
    </div>
    <fieldset className="daily-options" disabled={busy}>
      <legend>{words.whoWrote}</legend>
      {game.options.map((name, index) => <label key={name} className={choice === index ? "is-selected" : ""}>
        <input type="radio" name="boks-author-game" value={index} checked={choice === index} onChange={() => setChoice(index)} />
        <i aria-hidden="true" />
        <span translate="no">{labels[index]}</span>
      </label>)}
    </fieldset>
    {failed && <p className="daily-error" role="alert">{failed}</p>}
    <button type="button" className="daily-button daily-button--paper" disabled={busy || (signedIn && choice === null)} onClick={() => void answer(choice)}>
      {signedIn ? words.check : words.signInToCheck}
    </button>
    {signedIn && (confirmReveal ? <div className="daily-reveal" role="alertdialog" aria-label={words.reveal}>
      <p>{words.revealConfirm}</p>
      <div><button type="button" className="daily-link" onClick={() => void answer(null)} disabled={busy}>{words.reveal}</button><button type="button" className="daily-link" onClick={() => setConfirmReveal(false)}>{words.close}</button></div>
    </div> : <button type="button" className="daily-link daily-game__reveal" onClick={() => setConfirmReveal(true)}>{words.reveal}</button>)}
    <p className="daily-note daily-note--left daily-note--small">{words.gameNote}</p>
  </div>;
}
