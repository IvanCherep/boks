"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyReadingRequest,
  expireReadingRequest,
  isEmptyReadingRequest,
  normalizeReadingRequest,
  readingRequestIdleMs,
  type ReadingRequest,
} from "@/lib/boks/facets/request";

/**
 * The reader's "Что почитать" request for this pause.
 *
 * Lives in the tab (sessionStorage, so a reload within the pause keeps it),
 * never on the account: it is a request for now, not a taste. It is forgotten
 * after 30 minutes without activity - reading counts as activity, so a long
 * read keeps it. `ref` is what feed requests read, so the next slate and the
 * browser fallback continue under the same conditions.
 */
const storageKey = "boks.readingRequest";

type Stored = { request: ReadingRequest; at: number };

function readStored(): Stored | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const request = expireReadingRequest(normalizeReadingRequest(parsed.request), Number(parsed.at));
    return isEmptyReadingRequest(request) ? null : { request, at: Number(parsed.at) };
  } catch {
    return null;
  }
}

function writeStored(request: ReadingRequest, at: number) {
  try {
    if (isEmptyReadingRequest(request)) window.sessionStorage.removeItem(storageKey);
    else window.sessionStorage.setItem(storageKey, JSON.stringify({ request, at }));
  } catch {
    // Private mode: the request still lives for this page.
  }
}

/** `onExpire` runs when a non-empty request is forgotten for idleness. */
export function useReadingRequest(onExpire: () => void) {
  // Read once, on the client, before the reader's first feed request reads the
  // ref. The button that shows it renders only once a feed has loaded, which
  // never happens on the server, so the two renders cannot disagree.
  const [stored] = useState(() => (typeof window === "undefined" ? null : readStored()));
  const [request, setRequest] = useState<ReadingRequest>(() => stored?.request ?? emptyReadingRequest);
  const ref = useRef<ReadingRequest>(stored?.request ?? emptyReadingRequest);
  const lastActivity = useRef<number>(stored?.at ?? 0);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  const apply = useCallback((next: ReadingRequest) => {
    const normalized = normalizeReadingRequest(next);
    const now = Date.now();
    ref.current = normalized;
    lastActivity.current = now;
    setRequest(normalized);
    writeStored(normalized, now);
  }, []);

  /** Something the reader did: keeps the request alive. Cheap enough for every pointer event. */
  const touch = useCallback(() => {
    if (isEmptyReadingRequest(ref.current)) return;
    const now = Date.now();
    // Storage is written at most once a minute.
    if (now - lastActivity.current > 60_000) writeStored(ref.current, now);
    lastActivity.current = now;
  }, []);

  useEffect(() => {
    const check = () => {
      if (isEmptyReadingRequest(ref.current) || document.hidden) return;
      if (Date.now() - lastActivity.current < readingRequestIdleMs) return;
      ref.current = emptyReadingRequest;
      setRequest(emptyReadingRequest);
      writeStored(emptyReadingRequest, Date.now());
      onExpireRef.current();
    };
    const timer = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  return { request, ref, apply, touch };
}
