/**
 * The editors' reasoned answer on a piece sent from My page
 * (`docs/author-publishing.md`, "When the editors cannot take a piece"): a
 * request for changes or a refusal, with what it is about and the note the
 * author reads (`bok_editor_decisions`, `20261122140000_boks_editor_decisions.sql`).
 */

export const decisionKinds = ["recording", "text", "law", "other"] as const;
export type DecisionKind = (typeof decisionKinds)[number];
export type EditorDecisionKind = "changes" | "refused";

export type EditorDecision = {
  bokId: string;
  title: string;
  status: string;
  decision: EditorDecisionKind;
  kind: DecisionKind;
  note: string;
  decidedAt: string;
};

export const isDecisionKind = (value: unknown): value is DecisionKind => decisionKinds.includes(value as DecisionKind);

/** What the author does about a request for changes: read the piece again, or fix its text. */
export function changeAction(kind: DecisionKind): "voice" | "text" | "edit" {
  return kind === "recording" ? "voice" : kind === "text" ? "text" : "edit";
}

/** Whether a Studio decision can be sent: a kind chosen and a note the author can read. */
export function decisionReady(kind: DecisionKind | null, note: string) {
  return kind !== null && note.trim().length >= 2 && note.trim().length <= 2000;
}

/**
 * Whether a take may go back to the editors after they returned the piece for
 * its recording: only one made after their note (the database asks the same,
 * `save_my_bok`).
 */
export function takeAfterNote(takeCreatedAt: string, notBefore: string | null | undefined) {
  return !notBefore || Date.parse(takeCreatedAt) > Date.parse(notBefore);
}
