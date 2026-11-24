"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { defineMessages } from "@/lib/i18n/messages";
import { useMessages } from "@/components/boks/ui-language";
import {
  AUTHOR_SEARCH_QUERY_LIMIT,
  authorSearchTargetKey,
  createAuthorSearchController,
  type AuthorSearchAdapter,
  type AuthorSearchResult,
  type AuthorSearchSnapshot,
} from "./author-search-controller";

export const authorSearchMessages = defineMessages({
  title: "Find an author",
  placeholder: "Search...",
  searchLabel: "Search authors",
  clear: "Clear search",
  close: "Close author search",
  loading: "Searching...",
  empty: "Nothing found",
  error: "Search is unavailable. Try again.",
  retry: "Try again",
  refine: "Refine your search to see more authors.",
  results: "Authors",
}, {
  ru: {
    title: "Найти автора",
    placeholder: "Поиск...",
    searchLabel: "Поиск авторов",
    clear: "Очистить поиск",
    close: "Закрыть поиск авторов",
    loading: "Ищем...",
    empty: "Ничего не найдено",
    error: "Поиск недоступен. Попробуйте ещё раз.",
    retry: "Повторить",
    refine: "Уточните поиск, чтобы найти других авторов.",
    results: "Авторы",
  },
});

const initialSnapshot: AuthorSearchSnapshot = { phase: "idle", query: "", results: [], hasMore: false };
type Controller = ReturnType<typeof createAuthorSearchController>;

/**
 * The author search panel's content: title, field and one page of authors.
 * Hosted by the reader inside `ReaderSheet`, which owns Escape, Tab and the
 * focus it returns to the magnifier. A row is the author's portrait and name,
 * nothing they wrote. Picking one opens the existing author page; the panel
 * stays mounted under it (`active={false}`) with its query, so Back from the
 * author lands on the same list, focus on the row that was picked.
 *
 * While a new query is on its way the last rows stay on screen, faded and
 * inert, so the list does not blink at every letter; they cannot be tapped.
 */
export function AuthorSearchContent({
  search,
  onOpenAuthor,
  onClose,
  active = true,
}: {
  /** Stable: a module function or a memoised callback. */
  search: AuthorSearchAdapter;
  onOpenAuthor: (author: AuthorSearchResult) => void;
  onClose: () => void;
  active?: boolean;
}) {
  const words = useMessages(authorSearchMessages);
  const [query, setQuery] = useState("");
  const [snapshot, setSnapshot] = useState<AuthorSearchSnapshot>(initialSnapshot);
  // The rows last answered, shown faded while the next answer is on its way.
  const [settled, setSettled] = useState<readonly AuthorSearchResult[]>([]);
  const controller = useRef<Controller | null>(null);
  const queryRef = useRef("");
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const picked = useRef<string | null>(null);
  const wasActive = useRef(active);
  const refocus = useRef<"asked" | "waiting" | null>(null);

  useEffect(() => {
    if (!active) return;
    const current = createAuthorSearchController({
      search,
      onState: (next) => {
        setSnapshot(next);
        if (next.phase === "ready") setSettled(next.results);
        else if (next.phase === "error") setSettled([]);
      },
    });
    controller.current = current;
    current.setQuery(queryRef.current, { immediate: true });
    return () => {
      current.dispose();
      if (controller.current === current) controller.current = null;
    };
  }, [active, search]);

  // A pointer with hover (a computer) starts typing at once; a phone keeps
  // the keyboard down, so the authors are seen before anything is typed.
  // After the sheet has taken focus itself (its effect runs after this one).
  useEffect(() => {
    if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;
    const frame = window.requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Back from an author: focus returns to the row that opened them, once the
  // list (asked again on return) has answered and its rows can take focus.
  useEffect(() => {
    // "asked": back, the list is about to be asked again; "waiting": it has been.
    if (active && !wasActive.current) refocus.current = "asked";
    wasActive.current = active;
    if (!active || !refocus.current) return;
    if (snapshot.phase === "loading" || snapshot.phase === "idle") { refocus.current = "waiting"; return; }
    if (refocus.current !== "waiting") return;
    refocus.current = null;
    const key = picked.current;
    const row = key ? list.current?.querySelector<HTMLButtonElement>(`[data-author-key="${CSS.escape(key)}"]`) : null;
    (row ?? input.current)?.focus({ preventScroll: true });
  }, [active, snapshot]);

  function changeQuery(value: string, immediate = false) {
    const bounded = value.slice(0, AUTHOR_SEARCH_QUERY_LIMIT);
    queryRef.current = bounded;
    setQuery(bounded);
    list.current?.scrollTo({ top: 0 });
    controller.current?.setQuery(bounded, { immediate });
  }

  const loading = snapshot.phase === "loading" || snapshot.phase === "idle";
  const ready = snapshot.phase === "ready";
  const rows = ready ? snapshot.results : loading ? settled : [];
  const marks = useMemo(() => queryWords(snapshot.query), [snapshot.query]);

  return (
    <section className="boks-author-search" aria-labelledby="boks-author-search-title">
      <header className="boks-author-search__top">
        <h2 id="boks-author-search-title" className="boks-author-search__heading">{words.title}</h2>
        <button type="button" className="boks-author-search__close" onClick={onClose} aria-label={words.close}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className="boks-author-search__field">
        <svg className="boks-author-search__search-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
        <input
          ref={input}
          className="boks-author-search__input"
          type="search"
          name="author-search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          maxLength={AUTHOR_SEARCH_QUERY_LIMIT}
          value={query}
          disabled={!active}
          placeholder={words.placeholder}
          aria-label={words.searchLabel}
          aria-controls="boks-author-search-results"
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={(event) => {
            // Enter asks now rather than after the pause, and puts a phone's keyboard away.
            if (event.key === "Enter") {
              event.preventDefault();
              changeQuery(event.currentTarget.value, true);
              if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) event.currentTarget.blur();
            }
          }}
        />
        {query && <button type="button" className="boks-author-search__clear" disabled={!active} aria-label={words.clear} onClick={() => { changeQuery("", true); input.current?.focus({ preventScroll: true }); }}>
          <svg className="boks-author-search__clear-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" /></svg>
        </button>}
      </div>
      <div ref={list} className="boks-author-search__rows" id="boks-author-search-results" aria-busy={loading}>
        <p className="boks-author-search__live" role="status">{loading ? words.loading : ready && rows.length === 0 ? words.empty : ""}</p>
        {snapshot.phase === "error" && <div className="boks-author-search__problem" role="alert">
          <p>{words.error}</p>
          <button type="button" className="boks-author-search__retry" disabled={!active} onClick={() => controller.current?.retry()}>{words.retry}</button>
        </div>}
        {ready && rows.length === 0 && <p className="boks-author-search__empty" aria-hidden="true">{words.empty}</p>}
        {loading && rows.length === 0 && <ul className="boks-author-search__skeleton" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => <li key={index} style={{ ["--row" as string]: index }}><span /><span /></li>)}
        </ul>}
        {rows.length > 0 && <ul
          key={ready ? snapshot.query : "settled"}
          className={`boks-author-search__list${loading ? " boks-author-search__list--stale" : ""}`}
          aria-label={words.results}
          aria-hidden={loading || undefined}
          inert={loading || !active || undefined}
        >
          {rows.map((author, index) => {
            const key = authorSearchTargetKey(author.target);
            return <li key={key} style={{ ["--row" as string]: Math.min(index, 12) }}>
              <button
                type="button"
                className="boks-author-search__row"
                data-author-key={key}
                disabled={!active || loading}
                onClick={() => { picked.current = key; onOpenAuthor(author); }}
              >
                <AuthorSearchAvatar author={author} />
                <span className="boks-author-search__name">{ready ? highlight(author.displayName, marks) : author.displayName}</span>
                <svg className="boks-author-search__row-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M4 12h16m-6-6 6 6-6 6" /></svg>
              </button>
            </li>;
          })}
        </ul>}
        {ready && snapshot.hasMore && <p className="boks-author-search__more">{words.refine}</p>}
      </div>
    </section>
  );
}

function AuthorSearchAvatar({ author }: { author: AuthorSearchResult }) {
  const [failed, setFailed] = useState<string | null>(null);
  const url = author.avatarUrl && failed !== author.avatarUrl ? author.avatarUrl : null;
  return <span className={`boks-author-search__avatar${url ? "" : " boks-author-search__avatar--monogram"}`} aria-hidden="true">
    {url
      // eslint-disable-next-line @next/next/no-img-element -- a 52px portrait, already sized
      ? <img src={url} width={48} height={48} loading="lazy" decoding="async" alt="" onError={() => setFailed(url)} />
      : <span>{monogram(author.displayName)}</span>}
  </span>;
}

/** Initials of a name: «Антон Чехов» is АЧ, «Saki» is S. */
export function monogram(name: string): string {
  const parts = name.replace(/[,.].*$/, "").trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((part) => Array.from(part)[0] ?? "").join("").toLocaleUpperCase();
}

function fold(text: string): string {
  return text.toLocaleLowerCase().replace(/ё/g, "е");
}

function queryWords(query: string): string[] {
  return fold(query).replace(/^@+/, "").split(/[^0-9a-zа-я]+/i).filter((word) => word.length > 0);
}

/**
 * The query's words marked inside the name, where they occur as written
 * (a match found through the Latin spelling is not marked). Folding keeps
 * the length, so positions in the folded name are positions in the name.
 */
export function highlight(name: string, words: readonly string[]) {
  if (words.length === 0) return name;
  const folded = fold(name);
  const marked = new Array<boolean>(name.length).fill(false);
  for (const word of words) {
    let from = folded.indexOf(word);
    while (from !== -1) {
      for (let i = from; i < from + word.length; i += 1) marked[i] = true;
      from = folded.indexOf(word, from + word.length);
    }
  }
  if (!marked.includes(true)) return name;
  const pieces: Array<{ text: string; mark: boolean }> = [];
  for (let i = 0; i < name.length; i += 1) {
    const last = pieces[pieces.length - 1];
    if (last && last.mark === marked[i]) last.text += name[i];
    else pieces.push({ text: name[i], mark: marked[i] });
  }
  return pieces.map((piece, index) => <Fragment key={index}>{piece.mark ? <mark>{piece.text}</mark> : piece.text}</Fragment>);
}
