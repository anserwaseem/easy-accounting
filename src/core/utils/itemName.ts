/**
 * Item-name validation against characters an installation has reserved.
 *
 * Item names travel a long way: they become the SKU in the published catalog,
 * and downstream pipelines turn them into file names and URL path segments. A
 * pipeline may therefore need to reserve a character to use as an escape — and
 * once it does, an item name containing that character maps ambiguously, which
 * shows up as a product silently carrying the wrong image rather than as an
 * error.
 *
 * Which characters are reserved is not knowable here: it depends on what the
 * business publishes to. So the set is configuration (empty by default, i.e. no
 * restriction) and this module only enforces whatever was configured.
 */

/** Characters found in `name` that the installation has reserved. */
export function reservedCharsIn(name: string, reserved: string): string[] {
  if (!reserved) return [];
  const found = new Set<string>();
  for (const char of name) {
    if (reserved.includes(char)) found.add(char);
  }
  return [...found];
}

/** A message naming the offending characters, or null when the name is fine. */
export function itemNameError(name: string, reserved: string): string | null {
  const found = reservedCharsIn(name, reserved);
  if (found.length === 0) return null;
  const chars = found.map((c) => `"${c}"`).join(', ');
  return `Item name cannot contain ${chars} — reserved by this installation's publishing setup.`;
}
