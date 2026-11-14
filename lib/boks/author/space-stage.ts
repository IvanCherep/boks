/**
 * Where an author's page stands, for the team: one stage for the list of
 * pages, and the page's history as events, newest first. Pure, so Studio's
 * list and editor say the same thing and the rules are tested once.
 */

export type SpaceStage =
  | "not_invited"
  | "invite_pending"
  | "invite_expired"
  | "invite_revoked"
  | "changes_requested"
  | "author_reviewing"
  | "partly_published"
  | "published"
  | "unpublished";

export type StageInput = {
  kind: "author" | "editorial";
  status: "draft" | "published" | "unpublished" | "merged";
  owned: boolean;
  invite: { state: "pending" | "accepted" | "expired" | "revoked" } | null;
  ready: number;
  changesRequested: number;
};

export function spaceStage(page: StageInput): SpaceStage {
  if (page.status === "unpublished") return "unpublished";
  if (page.kind === "editorial") return page.status === "published" ? "published" : "author_reviewing";
  if (!page.owned) {
    if (!page.invite) return "not_invited";
    if (page.invite.state === "expired") return "invite_expired";
    if (page.invite.state === "revoked") return "invite_revoked";
    return "invite_pending";
  }
  if (page.changesRequested > 0) return "changes_requested";
  if (page.status === "draft") return "author_reviewing";
  return page.ready > 0 ? "partly_published" : "published";
}

export type TimelineEvent =
  | { at: string; kind: "invited"; email: string }
  | { at: string; kind: "accepted"; email: string }
  | { at: string; kind: "author_wrote"; body: string; workTitle: string | null }
  | { at: string; kind: "team_wrote"; body: string; workTitle: string | null }
  | { at: string; kind: "published"; titles: string[]; pagePublished: boolean; by: string | null };

export type TimelineInput = {
  invites: { email: string; createdAt: string; acceptedAt: string | null }[];
  messages: { fromAuthor: boolean; body: string; workTitle: string | null; createdAt: string }[];
  publications: { createdAt: string; pagePublished: boolean; actorHandle: string | null; items: { title: string }[] }[];
};

export function spaceTimeline(page: TimelineInput): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const invite of page.invites) {
    events.push({ at: invite.createdAt, kind: "invited", email: invite.email });
    if (invite.acceptedAt) events.push({ at: invite.acceptedAt, kind: "accepted", email: invite.email });
  }
  for (const message of page.messages) {
    events.push(
      message.fromAuthor
        ? { at: message.createdAt, kind: "author_wrote", body: message.body, workTitle: message.workTitle }
        : { at: message.createdAt, kind: "team_wrote", body: message.body, workTitle: message.workTitle }
    );
  }
  for (const publication of page.publications) {
    events.push({
      at: publication.createdAt,
      kind: "published",
      titles: publication.items.map((item) => item.title),
      pagePublished: publication.pagePublished,
      by: publication.actorHandle,
    });
  }
  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
