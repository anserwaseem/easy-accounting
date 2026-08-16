/**
 * Moves one entry of an array by a relative offset, returning a new array.
 *
 * Kept pure and separate so the index arithmetic (including the no-op cases at
 * either end) can be unit-tested without a component.
 */
export function moveByOffset<T>(
  items: T[],
  index: number,
  offset: number,
): T[] {
  const target = index + offset;
  if (
    index < 0 ||
    index >= items.length ||
    target < 0 ||
    target >= items.length ||
    offset === 0
  ) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}
