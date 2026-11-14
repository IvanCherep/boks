"use client";

import { supabase } from "@/lib/boks/supabase-client";

/**
 * Author spaces: pages prepared in Studio, handed to their author by an
 * invitation, and published by the author (or, for a classic, by the team).
 * Every call is an RPC from `20261114100000_boks_author_spaces.sql`; the
 * database checks the role and the ownership, never this file.
 */

export type SpaceKind = "author" | "editorial";
export type SpaceStatus = "draft" | "published" | "unpublished" | "merged";
export type WorkFormat = "text" | "series";
export type WorkStatus = "preparing" | "ready" | "changes_requested" | "published" | "withdrawn";
export type InviteState = "pending" | "accepted" | "expired" | "revoked";

export type SpaceWork = {
  id: string;
  position: number | null;
  title: string;
  format: WorkFormat;
  status: WorkStatus;
  revision: number;
  publishedRevision: number | null;
  seriesPublished: boolean;
  /** Token of a link-only Series made for this text; team and owner only. */
  seriesPiece: string | null;
  note: string | null;
  rightsNote: string | null;
  readyAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  bokId: string | null;
  bokTitle: string | null;
  bokStatus: string | null;
  characters: number;
  body?: string | null;
};

/** One message of a page's conversation between its author and the team. */
export type SpaceMessage = {
  id: string;
  fromAuthor: boolean;
  body: string;
  workId: string | null;
  workTitle: string | null;
  createdAt: string;
};

export type SpaceInvite = {
  id: string;
  email: string;
  state: InviteState;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  problem: string | null;
};

export type SpacePublication = {
  requestId: string;
  basis: "owner_terms" | "editorial";
  termsVersion: string | null;
  rightsBasis: string | null;
  items: { workId: string; revision: number; bokId: string; title: string; format: WorkFormat; withSeries?: boolean }[];
  pagePublished: boolean;
  actorHandle: string | null;
  createdAt: string;
};

export type StudioSpace = {
  id: string;
  kind: SpaceKind;
  status: SpaceStatus;
  name: string | null;
  handle: string | null;
  proposedHandle: string | null;
  owned: boolean;
  ownerHandle: string | null;
  mergedInto: string | null;
  photo: string | null;
  photoVersion: number | null;
  rightsBasis: string | null;
  rightsSource: string | null;
  /** The link preview card, `/l/<token>/f/<name>-share.jpg`; kept through a rename. */
  shareCard: string | null;
  /** Its moving version, `/l/<token>/f/<name>-share.mp4`. */
  shareVideo: string | null;
  messages: SpaceMessage[];
  /** The author's messages the team has not read. */
  unread: number;
  version: number;
  orderVersion: number;
  publishedAt: string | null;
  works: SpaceWork[];
  invites: SpaceInvite[];
  publications: SpacePublication[];
};

export type StudioSpaceRow = {
  id: string;
  kind: SpaceKind;
  status: SpaceStatus;
  name: string | null;
  handle: string | null;
  owned: boolean;
  photoVersion: number | null;
  works: number;
  ready: number;
  changesRequested: number;
  published: number;
  invite: { state: InviteState; expiresAt: string; problem: string | null } | null;
  unread: number;
  updatedAt: string;
};

export type FoundBok = { id: string; title: string; authorName: string | null; authorHandle: string | null };

/** One line of a page as its owner orders it: a published bok or a prepared work. */
export type PageItem = {
  key: string;
  bokId: string | null;
  title: string;
  published: boolean;
  /** A work the author took off the site themselves; it can be put back. */
  hidden?: boolean;
  format: WorkFormat;
  seriesHeld?: boolean;
  work: SpaceWork | null;
};

export type MyAuthorSpace = {
  space: { id: string; status: SpaceStatus; orderVersion: number; publishedAt: string | null } | null;
  handle: string | null;
  name?: string | null;
  shareCard?: string | null;
  shareVideo?: string | null;
  messages?: SpaceMessage[];
  /** The team's messages the author has not read. */
  unread?: number;
  orderVersion: number;
  items: PageItem[];
};

export type PreviewItem = {
  key: string;
  workId?: string;
  bokId: string | null;
  title: string;
  published: boolean;
  format: WorkFormat;
  seriesHeld?: boolean;
  status?: WorkStatus;
  revision?: number;
  seriesPiece?: string | null;
  body: string | null;
};

export type SpacePreview = {
  id: string;
  kind: SpaceKind;
  status: SpaceStatus;
  access: "editor" | "owner";
  handle: string | null;
  name: string | null;
  photo: string | null;
  items: PreviewItem[];
};

export type InvitePeek =
  | { state: "sign_in" | "invalid" | "expired" | "revoked" | "used" | "accepted" }
  | { state: "wrong_email"; emailHint: string | null }
  | { state: "pending"; existingPage: boolean; works: number; series?: number; name: string | null; handle?: string | null };

export type InviteAcceptance =
  | { state: "accepted"; existingPage?: boolean; works?: number; spaceId?: string; repeat?: boolean }
  | { state: "invalid" | "expired" | "revoked" | "used" | "conflict" }
  | { state: "wrong_email"; emailHint: string | null };

export type PublicationResult = {
  requestId: string;
  handle: string | null;
  pagePublished: boolean;
  published: { workId: string; revision: number; bokId: string; title: string; format: WorkFormat; withSeries?: boolean }[];
  repeat?: boolean;
};

export type FollowedPage = {
  pageId: string;
  authorName: string;
  authorHandle: string;
  kind: SpaceKind;
  photoVersion: number | null;
  followedAt: string;
  published: number;
};

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const result = await supabase.rpc(name, args);
  if (result.error) throw result.error;
  return result.data as T;
}

// ------------------------------------------------------------------ Studio

export const loadStudioSpaces = (query: string, limit = 50, offset = 0) =>
  call<{ total: number; rows: StudioSpaceRow[] }>("studio_author_spaces", { p_query: query, p_limit: limit, p_offset: offset });

export const loadStudioSpace = (id: string) => call<StudioSpace>("studio_author_space", { p_space_id: id });

export const saveStudioSpace = (input: { id: string | null; kind: SpaceKind; name: string; handle: string; photo: string; version: number }) =>
  call<StudioSpace>("studio_save_author_space", {
    p_space_id: input.id,
    p_kind: input.kind,
    p_name: input.name,
    p_handle: input.handle,
    p_photo: input.photo,
    p_version: input.version,
  });

export const saveSpaceWork = (input: { spaceId: string; workId: string | null; title: string; body: string; format: WorkFormat; bokId: string | null }) =>
  call<StudioSpace>("studio_save_space_work", {
    p_space_id: input.spaceId,
    p_work_id: input.workId,
    p_title: input.title,
    p_body: input.body,
    p_format: input.format,
    p_bok_id: input.bokId,
  });

export const setSpaceWorkStatus = (workId: string, status: "preparing" | "ready", rightsNote = "", reply = "") =>
  call<StudioSpace>("studio_set_space_work_status", { p_work_id: workId, p_status: status, p_rights_note: rightsNote, p_reply: reply });

export const studioSendMessage = (spaceId: string, body: string, workId: string | null = null) =>
  call<StudioSpace>("studio_send_author_space_message", { p_space_id: spaceId, p_body: body, p_work_id: workId });

export const studioMarkSeen = (spaceId: string) => call<void>("studio_mark_author_space_seen", { p_space_id: spaceId });

export const setAuthorSpaceShare = (spaceId: string, card: string, video = "") =>
  call<StudioSpace>("studio_set_author_space_share", { p_space_id: spaceId, p_card: card, p_video: video });

/** Attach (or replace, or with "" remove) a link-only Series; `live` once its text is published and registered. */
export const setSpaceWorkSeries = (workId: string, piece: string, live = false) =>
  call<StudioSpace>("studio_set_space_work_series", { p_work_id: workId, p_piece: piece, p_live: live });

export const removeSpaceWork = (workId: string) => call<StudioSpace>("studio_remove_space_work", { p_work_id: workId });

export const findBoksToAttach = (query: string, spaceId: string | null) =>
  call<FoundBok[]>("studio_find_boks", { p_query: query, p_space_id: spaceId });

export const issueAuthorInvite = (spaceId: string, email: string) =>
  call<{ token: string; invite: SpaceInvite }>("studio_issue_author_invite", { p_space_id: spaceId, p_email: email });

export const revokeAuthorInvite = (inviteId: string) => call<StudioSpace>("studio_revoke_author_invite", { p_invite_id: inviteId });

export const publishEditorialSpace = (input: {
  spaceId: string;
  items: { workId: string; revision: number }[];
  rightsBasis: string;
  rightsSource: string;
  rightsConfirmed: boolean;
  requestId: string;
}) =>
  call<PublicationResult>("studio_publish_editorial_space", {
    p_space_id: input.spaceId,
    p_items: input.items,
    p_rights_basis: input.rightsBasis,
    p_rights_source: input.rightsSource,
    p_rights_confirmed: input.rightsConfirmed,
    p_request_id: input.requestId,
  });

export const setEditorialSpaceStatus = (spaceId: string, status: "published" | "unpublished") =>
  call<StudioSpace>("studio_set_editorial_space_status", { p_space_id: spaceId, p_status: status });

// ------------------------------------------------------- the owner and both

export const loadSpacePreview = (spaceId: string | null) => call<SpacePreview>("get_author_space_preview", { p_space_id: spaceId });

export const loadMyAuthorSpace = () => call<MyAuthorSpace>("get_my_author_space");

export const peekAuthorInvite = (token: string) => call<InvitePeek>("peek_author_invite", { p_token: token });

export const acceptAuthorInvite = (token: string | null, inviteId: string | null = null) =>
  call<InviteAcceptance>("accept_author_invite", { p_token: token, p_invite_id: inviteId });

/** A page the team prepared for this account's email, offered in the cabinet without any link. */
export type InviteOffer = { inviteId: string; state: "pending"; existingPage: boolean; works: number; series?: number; name: string | null; handle?: string | null; expiresAt: string };

export async function loadMyInvites(): Promise<InviteOffer[]> {
  try {
    return (await call<InviteOffer[] | null>("get_my_author_invites")) ?? [];
  } catch {
    return [];
  }
}

export const requestSpaceChanges = (workId: string, note: string) =>
  call<MyAuthorSpace>("request_author_space_changes", { p_work_id: workId, p_note: note });

export const saveSpaceOrder = (spaceId: string | null, keys: string[], orderVersion: number) =>
  call<{ spaceId: string; orderVersion: number }>("save_author_space_order", {
    p_space_id: spaceId,
    p_items: keys,
    p_order_version: orderVersion,
  });

export const publishMyAuthorSpace = (input: { items: { workId: string; revision: number }[]; publishPage: boolean; termsVersion: string; requestId: string }) =>
  call<PublicationResult>("publish_my_author_space", {
    p_items: input.items,
    p_publish_page: input.publishPage,
    p_terms_version: input.termsVersion,
    p_request_id: input.requestId,
  });

export const sendMyMessage = (body: string, workId: string | null = null) =>
  call<MyAuthorSpace>("send_author_space_message", { p_body: body, p_work_id: workId });

export const markMyMessagesSeen = () => call<void>("mark_author_space_messages_seen");

export const unpublishSpaceWork = (workId: string) => call<{ ok: true; workId: string }>("unpublish_space_work", { p_work_id: workId });

// ------------------------------------------------------------------ readers

export async function setAuthorPageFollow(pageId: string, following: boolean) {
  return call<{ pageId: string; following: boolean; followers: number }>("set_author_page_follow", {
    p_page_id: pageId,
    p_following: following,
  });
}

export async function loadFollowedPages(): Promise<FollowedPage[]> {
  try {
    return (await call<FollowedPage[] | null>("get_my_followed_pages")) ?? [];
  } catch (error) {
    // A database without this migration yet: no editorial follows.
    const code = (error as { code?: string })?.code;
    if (code === "PGRST202" || code === "42883") return [];
    throw error;
  }
}
