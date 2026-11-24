/**
 * Studio → Authors → Заявки as a small CRM (`docs/author-applications.md`,
 * "Working an application"): which applications to show, in what order, how
 * long each has waited and how to reach the person. Pure, so it is tested.
 */
import { applicationMover, closedApplicationStages, stuckAfterDays, type ApplicationStage, type Mover } from "@/lib/boks/author/pipeline";

export type ApplicationFilter = "open" | "ours" | "waiting" | "closed" | "all";
export const applicationFilters: readonly ApplicationFilter[] = ["open", "ours", "waiting", "closed", "all"];

export type ApplicationLike = {
  id: number;
  name: string;
  contact: string;
  links: string;
  stage: ApplicationStage;
  stageAt: string;
  createdAt: string;
  handle: string | null;
  email: string | null;
  focus: string | null;
};

const DAY = 86_400_000;
const isClosed = (stage: ApplicationStage) => closedApplicationStages.includes(stage);

/** Since when the application has waited on this stage: a new one since it came. */
export const waitingSince = (row: ApplicationLike) => (row.stage === "new" ? row.createdAt : row.stageAt);

export type ApplicationWait = { mover: Mover; days: number; stuck: boolean };

/** Whose move it is, for how many whole days, and whether that is too long (the same limits as «Ведение авторов»). */
export function applicationWait(row: ApplicationLike, now = new Date()): ApplicationWait {
  const mover = applicationMover(row.stage);
  const days = Math.max(0, Math.floor((now.getTime() - new Date(waitingSince(row)).getTime()) / DAY));
  const limit = row.stage === "new" ? stuckAfterDays.newApplication
    : row.stage === "written" ? stuckAfterDays.awaitingReply
      : isClosed(row.stage) ? null : stuckAfterDays.ourReply;
  return { mover, days, stuck: limit !== null && days >= limit };
}

export function matchesApplicationFilter(row: ApplicationLike, filter: ApplicationFilter) {
  switch (filter) {
    case "open": return !isClosed(row.stage);
    case "ours": return applicationMover(row.stage) === "team";
    case "waiting": return row.stage === "written";
    case "closed": return isClosed(row.stage);
    case "all": return true;
  }
}

export function matchesApplicationSearch(row: ApplicationLike, query: string) {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  if (!q) return true;
  return [row.name, row.contact, row.links, row.handle, row.email, row.focus].some((field) => field?.toLowerCase().includes(q));
}

/**
 * Open ones: ours before the author's, and within each the longest waiting
 * first, so the top of the list is what to do now. Closed ones: the latest
 * closed first.
 */
export function orderApplications<T extends ApplicationLike>(rows: readonly T[]): T[] {
  const rank = (row: T) => (isClosed(row.stage) ? 2 : applicationMover(row.stage) === "team" ? 0 : 1);
  return [...rows].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank) return byRank;
    const at = (row: T) => new Date(waitingSince(row)).getTime();
    return rank(a) === 2 ? at(b) - at(a) : at(a) - at(b);
  });
}

export function countApplications(rows: readonly ApplicationLike[]): Record<ApplicationFilter, number> {
  return Object.fromEntries(applicationFilters.map((filter) => [filter, rows.filter((row) => matchesApplicationFilter(row, filter)).length])) as Record<ApplicationFilter, number>;
}

/** A link that opens a conversation with the contact the person left, if it is one we can tell. */
export function contactHref(contact: string): string | null {
  const value = contact.trim();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return `mailto:${value}`;
  if (/^https?:\/\/\S+$/i.test(value)) return value;
  const telegram = value.match(/^(?:@|(?:https?:\/\/)?t\.me\/)([A-Za-z][A-Za-z0-9_]{3,31})$/i);
  if (telegram) return `https://t.me/${telegram[1]}`;
  if (/^(?:t\.me|vk\.com|vk\.ru)\/\S+$/i.test(value)) return `https://${value}`;
  const digits = value.replace(/[\s()\-]/g, "");
  if (/^\+?\d{10,15}$/.test(digits)) return `tel:${digits}`;
  return null;
}
