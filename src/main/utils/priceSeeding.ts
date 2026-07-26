/**
 * Pure logic for seeding / revising a price list in bulk.
 *
 * Two workflows share it:
 *  - bootstrap a new list from the base item price (e.g. base × 1.2), so a
 *    freshly created list is usable without typing a price per item;
 *  - revise an existing list by a factor (e.g. × 1.05 for an annual increase).
 *
 * Kept free of DB/Electron imports so the arithmetic, rounding, skip rules and
 * overwrite semantics can be unit-tested, and so the caller can show an exact
 * preview of what would change before anything is written.
 */

/** Where the pre-multiplier price comes from. */
export type SeedSource = 'base' | 'list';

export interface SeedInputRow {
  inventoryId: number;
  /** Item name/SKU — only used to make previews readable. */
  name: string;
  /** inventory.price */
  basePrice: number;
  /** Existing price on the target list, if any. */
  currentPrice?: number | null;
}

export interface SeedOptions {
  source: SeedSource;
  /** Multiplied against the source price. 1 = copy unchanged. */
  multiplier: number;
  /** Round the result to the nearest multiple of this. 1 = whole numbers. */
  roundTo: number;
  /** When false, rows that already have a price on the list are left alone. */
  overwriteExisting: boolean;
}

export interface SeedChange {
  inventoryId: number;
  name: string;
  from: number | null;
  to: number;
}

export interface SeedPlan {
  changes: SeedChange[];
  /** Rows skipped because they already have a price and overwrite is off. */
  skippedExisting: number;
  /** Rows skipped because the source price was missing or <= 0. */
  skippedNoSource: number;
  /** Rows whose computed price equals what is already stored. */
  unchanged: number;
}

/** Rounds to the nearest multiple of `roundTo` (halves round up). */
export function roundToNearest(value: number, roundTo: number): number {
  if (!Number.isFinite(value)) return 0;
  const step = Number.isFinite(roundTo) && roundTo > 0 ? roundTo : 1;
  return Math.round(value / step) * step;
}

export interface SeedOptionsValidation {
  ok: boolean;
  errors: string[];
}

/** Guard rails for user-entered multiplier / rounding. */
export function validateSeedOptions(options: {
  multiplier: number;
  roundTo: number;
}): SeedOptionsValidation {
  const errors: string[] = [];
  if (!Number.isFinite(options.multiplier) || options.multiplier <= 0) {
    errors.push('Multiplier must be a number greater than 0');
  }
  if (
    !Number.isFinite(options.roundTo) ||
    options.roundTo <= 0 ||
    !Number.isInteger(options.roundTo)
  ) {
    errors.push('Rounding must be a whole number greater than 0');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Works out exactly which prices would be written. Never mutates its input;
 * the result is both the preview and the write plan, so what the user approves
 * is precisely what gets applied.
 */
export function buildSeedPlan(
  rows: SeedInputRow[],
  options: SeedOptions,
): SeedPlan {
  const plan: SeedPlan = {
    changes: [],
    skippedExisting: 0,
    skippedNoSource: 0,
    unchanged: 0,
  };

  for (const row of rows) {
    const current =
      typeof row.currentPrice === 'number' && row.currentPrice > 0
        ? row.currentPrice
        : null;

    if (current !== null && !options.overwriteExisting) {
      plan.skippedExisting += 1;
      continue;
    }

    const sourcePrice = options.source === 'base' ? row.basePrice : current;
    if (
      sourcePrice == null ||
      !Number.isFinite(sourcePrice) ||
      sourcePrice <= 0
    ) {
      plan.skippedNoSource += 1;
      continue;
    }

    const next = roundToNearest(
      sourcePrice * options.multiplier,
      options.roundTo,
    );
    if (next <= 0) {
      plan.skippedNoSource += 1;
      continue;
    }
    if (next === current) {
      plan.unchanged += 1;
      continue;
    }

    plan.changes.push({
      inventoryId: row.inventoryId,
      name: row.name,
      from: current,
      to: next,
    });
  }

  return plan;
}

/** A few representative before→after pairs, for the confirmation dialog. */
export function sampleSeedChanges(plan: SeedPlan, limit = 3): SeedChange[] {
  return plan.changes.slice(0, limit);
}
