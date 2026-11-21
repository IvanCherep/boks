"use client";

import { useMessages } from "@/components/boks/ui-language";
import type { EditorDecision } from "@/lib/boks/author/editor-decisions";
import { decisionWords } from "./decision-words";

/**
 * The editors' answer on a piece, calm and plain: what they ask or why they
 * cannot publish it, what it is about, and their own words. On My page and at
 * the top of the composer.
 */
export function DecisionNote({ decision, compact = false, onRequests }: { decision: EditorDecision; compact?: boolean; onRequests?: () => void }) {
  const d = useMessages(decisionWords);
  const refused = decision.decision === "refused";
  return (
    <div className={`acomp-decision${refused ? " is-refused" : ""}${compact ? " is-compact" : ""}`} role="status">
      {!compact && <strong className="acomp-decision__title">{refused ? d.refusedTitle : d.changesTitle}</strong>}
      <span className="acomp-decision__kind">{d.about(d.kinds[decision.kind])}</span>
      <blockquote className="acomp-decision__note">{decision.note}</blockquote>
      {refused ? (
        <>
          <small>{d.refusedText}</small>
          <small>
            {onRequests
              ? <button type="button" className="acomp-decision__link" onClick={onRequests}>{d.disagree(d.requestsPlace)}</button>
              : d.disagree(d.requestsPlace)}
          </small>
        </>
      ) : (
        <small>{decision.kind === "recording" ? `${d.changesHint} ${d.recordingHint}` : d.changesHint}</small>
      )}
    </div>
  );
}
