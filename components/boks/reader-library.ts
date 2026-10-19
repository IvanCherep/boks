import type { ReaderLibraryItem } from "@/components/boks/client-types";

export type ReaderLibraryView = "read" | "liked" | "commented";

export function readerLibraryActivityAt(item: ReaderLibraryItem, view: ReaderLibraryView) {
  if (view === "liked") return item.likedAt;
  if (view === "commented") return item.commentedAt;
  return item.readAt;
}

/** Existing database timestamps, displayed in the reader's local time zone. */
export function readerLibraryActivityTime(at: string | null | undefined, locale: string, timeZone?: string): string | null {
  if (!at || !/T\d{2}:\d{2}/u.test(at)) return null;
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(date);
}

/** Selects one account-library view without changing the RPC's source array. */
export function selectReaderLibraryItems(
  items: readonly ReaderLibraryItem[],
  view: ReaderLibraryView,
  query = ""
) {
  const normalizedQuery = query.trim().toLowerCase();

  return items
    .filter((item) => Boolean(readerLibraryActivityAt(item, view)))
    .filter((item) =>
      !normalizedQuery
      || `${item.title} ${item.authorName}`.toLowerCase().includes(normalizedQuery)
    )
    .sort((left, right) => {
      const leftAt = readerLibraryActivityAt(left, view) ?? "";
      const rightAt = readerLibraryActivityAt(right, view) ?? "";
      return rightAt.localeCompare(leftAt);
    });
}
