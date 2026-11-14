/**
 * One order for everything on an author page (`save_author_space_order`).
 * The cabinet moves a work by its handle (drag) or by ↑/↓ (phone, keyboard);
 * both end up here, so both obey the same edges.
 */

/** `keys` with the item at `from` moved by `delta` places, clamped to the list. */
export function moveBy<T>(items: readonly T[], from: number, delta: number): T[] {
  return moveTo(items, from, from + delta);
}

/** `items` with the item at `from` placed at `to` (its index afterwards), clamped to the list. */
export function moveTo<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  if (target === from) return next;
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Whether two orders differ, so Save can stay disabled until something moved. */
export function orderChanged(before: readonly string[], after: readonly string[]) {
  return before.length !== after.length || before.some((key, index) => key !== after[index]);
}
