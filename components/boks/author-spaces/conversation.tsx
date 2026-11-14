"use client";

import { useState } from "react";
import type { SpaceMessage } from "./data";

/** "14 нояб., 20:35": when a message or an event happened, in the interface language. */
export function shortDateTime(iso: string, language: string) {
  return new Date(iso).toLocaleString(language === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * A page's conversation, drawn the same for both sides: the author's notes
 * (on the design, the page, a work) and the team's answers, including the
 * automatic "the changes are made". `mine` says which side is reading.
 */
export function Conversation({
  messages,
  mine,
  busy,
  onSend,
  labels,
  language,
}: {
  messages: SpaceMessage[];
  mine: "author" | "team";
  busy: boolean;
  onSend: (body: string) => Promise<boolean>;
  labels: { author: string; team: string; about: (title: string) => string; placeholder: string; send: string; empty: string };
  language: string;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="conv">
      {messages.length === 0 ? (
        <p className="conv-empty">{labels.empty}</p>
      ) : (
        <ol className="conv-list">
          {messages.map((message) => {
            const own = (mine === "author") === message.fromAuthor;
            return (
              <li key={message.id} className={`conv-msg${own ? " is-own" : ""}${message.fromAuthor ? "" : " is-team"}`}>
                <span className="conv-meta">
                  {message.fromAuthor ? labels.author : labels.team} · {shortDateTime(message.createdAt, language)}
                  {message.workTitle && <> · {labels.about(message.workTitle)}</>}
                </span>
                <span className="conv-body">{message.body}</span>
              </li>
            );
          })}
        </ol>
      )}
      <form
        className="conv-form"
        onSubmit={(event) => {
          event.preventDefault();
          const body = draft.trim();
          if (!body) return;
          void onSend(body).then((sent) => sent && setDraft(""));
        }}
      >
        <textarea value={draft} maxLength={2000} rows={3} placeholder={labels.placeholder} onChange={(event) => setDraft(event.target.value)} />
        <button type="submit" className="btn" disabled={busy || !draft.trim()}>{labels.send}</button>
      </form>
    </div>
  );
}
