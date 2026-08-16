/**
 * Deciding what "copy attributes from another item" would do.
 *
 * Items in a family usually differ by one or two attributes, so filling a new
 * item means retyping values that already exist next door. Copying is offered
 * as a *prefill*: this module works out what each field would become, the user
 * confirms, and only then does the form change — nothing is written until they
 * save, so a wrong source costs a click rather than an item's data.
 *
 * Pure: no React, no IPC. The UI renders these rows and reports which keys the
 * user kept selected.
 */
import type { AttributeDefinition, InventoryItem } from 'types';

/** What copying would do to one field. */
export type CopyAction =
  /** this item has no value and the source does — the safe case */
  | 'fill'
  /** both have values and they differ — replacing loses what is here */
  | 'overwrite'
  /** both already agree, so copying changes nothing */
  | 'same';

export interface CopyRow {
  key: string;
  label: string;
  /** current value as shown in the form ('' when empty) */
  current: string;
  /** value the source would supply (never '') */
  incoming: string;
  action: CopyAction;
}

/** Renders a stored attribute value the way the editor's inputs hold it. */
export const displayValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : '';
  return String(value);
};

/**
 * One row per attribute the source could contribute.
 *
 * Fields the source leaves empty are omitted rather than listed as no-ops: the
 * point of the preview is to be readable at a glance, and a source item that
 * shares only half its attributes should produce a short list, not a long one
 * padded with blanks.
 */
export function buildCopyPlan(
  definitions: AttributeDefinition[],
  current: Record<string, string>,
  source: InventoryItem,
): CopyRow[] {
  const rows: CopyRow[] = [];
  for (const def of definitions) {
    const incoming = displayValue(source.attributes?.[def.key]);
    if (incoming === '') continue; // nothing to give
    const here = current[def.key] ?? '';
    let action: CopyAction = 'fill';
    if (here !== '') action = here === incoming ? 'same' : 'overwrite';
    rows.push({
      key: def.key,
      label: def.label,
      current: here,
      incoming,
      action,
    });
  }
  return rows;
}

/**
 * Which rows start out selected: the ones that only add information.
 *
 * Overwrites are left unselected on purpose. The common case is "this item is
 * blank, fill it in", and defaulting to replace would quietly destroy the one
 * or two values that make this item different from its sibling — exactly the
 * values the user came here to keep.
 */
export function defaultSelection(rows: CopyRow[]): Set<string> {
  return new Set(rows.filter((r) => r.action === 'fill').map((r) => r.key));
}

/** The form values after copying the selected rows. Does not mutate its input. */
export function applyCopyPlan(
  current: Record<string, string>,
  rows: CopyRow[],
  selected: Set<string>,
): Record<string, string> {
  const next = { ...current };
  for (const row of rows) {
    if (selected.has(row.key)) next[row.key] = row.incoming;
  }
  return next;
}

/** How many rows would actually change something. */
export function countChanges(rows: CopyRow[], selected: Set<string>): number {
  return rows.filter((r) => selected.has(r.key) && r.action !== 'same').length;
}

/**
 * Candidate source items, best first.
 *
 * Family members come first because that is the real use case — a variant
 * differing by its binding — and within each group the items carrying the most
 * attributes come first, since a fuller source saves more typing. Items with no
 * attributes at all are dropped: they have nothing to copy.
 */
export function rankCandidates(
  items: InventoryItem[],
  target: InventoryItem,
): InventoryItem[] {
  const familyOf = (item: InventoryItem) => item.parentId ?? item.id;
  const targetFamily = familyOf(target);
  return items
    .filter(
      (item) =>
        item.id !== target.id && Object.keys(item.attributes ?? {}).length > 0,
    )
    .sort((a, b) => {
      const aFamily = familyOf(a) === targetFamily ? 0 : 1;
      const bFamily = familyOf(b) === targetFamily ? 0 : 1;
      if (aFamily !== bFamily) return aFamily - bFamily;
      const aCount = Object.keys(a.attributes ?? {}).length;
      const bCount = Object.keys(b.attributes ?? {}).length;
      if (aCount !== bCount) return bCount - aCount;
      return a.name.localeCompare(b.name);
    });
}

/** True when the item belongs to the same family as the target. */
export function isSameFamily(
  item: InventoryItem,
  target: InventoryItem,
): boolean {
  return (item.parentId ?? item.id) === (target.parentId ?? target.id);
}

/** Case-insensitive name match, for the candidate search box. */
export function matchesSearch(item: InventoryItem, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return item.name.toLowerCase().includes(term);
}

/**
 * The attributes that actually tell these items apart.
 *
 * A count of filled attributes is a useless label (most items carry the same
 * number), and so is showing the first few attributes in order: within a family
 * the size, lines and paper are identical by definition, and the one attribute
 * that differs — usually the binding — gets pushed off the end. So rank the
 * attributes by how many distinct values they take across the candidates, and
 * describe each row with those. Ties keep definition order for stable output.
 *
 * Two constraints make this useful rather than merely clever:
 *
 * - Only *public* attributes are considered. Internal keys (import notes,
 *   grouping codes) are often the most varied in the whole catalogue and the
 *   least meaningful to read, so variance alone picks exactly the wrong ones.
 * - `candidates` must be the group actually on screen. Variance over the whole
 *   catalogue says nothing about what distinguishes one family's members.
 */
export function discriminatingKeys(
  candidates: InventoryItem[],
  definitions: AttributeDefinition[],
  max = 3,
): string[] {
  const readable = definitions.filter(
    (d) => d.isPublic === 1 && d.valueType !== 'bool',
  );
  const spread = readable.map((def, index) => {
    const values = new Set<string>();
    for (const candidate of candidates) {
      const value = displayValue(candidate.attributes?.[def.key]);
      if (value !== '') values.add(value);
    }
    return { key: def.key, distinct: values.size, index };
  });
  return spread
    .filter((s) => s.distinct > 1)
    .sort((a, b) => b.distinct - a.distinct || a.index - b.index)
    .slice(0, max)
    .map((s) => s.key);
}

/**
 * A one-line description of an item, for the source picker.
 *
 * `keys` comes from `discriminatingKeys` over the whole candidate list, so every
 * row is described by the same attributes and the rows read as comparable.
 */
export function summaryOf(
  item: InventoryItem,
  keys: readonly string[],
): string {
  return keys
    .map((key) => displayValue(item.attributes?.[key]))
    .filter((value) => value !== '')
    .join(' · ');
}

/** Candidates split into the target's family and everything else, order kept. */
export function groupCandidates(
  ranked: InventoryItem[],
  target: InventoryItem,
): { family: InventoryItem[]; others: InventoryItem[] } {
  const family: InventoryItem[] = [];
  const others: InventoryItem[] = [];
  for (const item of ranked) {
    (isSameFamily(item, target) ? family : others).push(item);
  }
  return { family, others };
}

/** Rows a user is allowed to tick — the no-ops are fixed. */
export function selectableKeys(rows: CopyRow[]): string[] {
  return rows.filter((r) => r.action !== 'same').map((r) => r.key);
}

/** Radix Checkbox's tri-state value for the select-all header. */
export function headerCheckedValue(
  rows: CopyRow[],
  selected: Set<string>,
): boolean | 'indeterminate' {
  const state = selectionState(rows, selected);
  if (state === 'all') return true;
  if (state === 'some') return 'indeterminate';
  return false;
}

/** Header checkbox state for the preview table. */
export function selectionState(
  rows: CopyRow[],
  selected: Set<string>,
): 'all' | 'none' | 'some' {
  const keys = selectableKeys(rows);
  if (keys.length === 0) return 'none';
  const picked = keys.filter((k) => selected.has(k)).length;
  if (picked === 0) return 'none';
  return picked === keys.length ? 'all' : 'some';
}

/** Select-all / select-none, leaving the no-op rows out either way. */
export function toggleAll(rows: CopyRow[], selected: Set<string>): Set<string> {
  return selectionState(rows, selected) === 'all'
    ? new Set()
    : new Set(selectableKeys(rows));
}
