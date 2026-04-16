import type { FieldValues, UseFormReturn } from 'react-hook-form';

/**
 * Focus scheduling for the new-invoice line-item grid.
 *
 * WHY retries: after append(), React re-renders asynchronously and the new row's
 * VirtualSelect trigger may not be in the DOM yet. Retries cover the mounting window.
 *
 * WHY DOM fallback (scheduleItemFieldFocusAfterNewRow): form.setFocus relies on RHF's
 * _fields registry. With virtualization, non-visible FormFields aren't mounted, so
 * setFocus often can't find the ref. The DOM query finds the input directly.
 *
 * WHY focus guard (re-acquire disconnected element): post-append re-renders can unmount
 * and remount the VirtualSelect trigger input. The guard detects when the focused element
 * is disconnected and re-queries the DOM for the replacement.
 */
const FOCUS_RETRY_DELAYS_MS = [0, 80, 200, 400, 650] as const;

type SetFocusPath<T extends FieldValues> = Parameters<
  UseFormReturn<T>['setFocus']
>[0];

/**
 * Attempt focus with retries; stop as soon as activeElement changes (focus landed).
 * Only the first successful attempt uses `shouldSelect` — retries never re-select text
 * so fast typing after focus is not disrupted.
 */
function scheduleFocusWithRetries<T extends FieldValues>(
  form: UseFormReturn<T>,
  path: SetFocusPath<T>,
  shouldSelectOnFirst: boolean,
): void {
  let done = false;

  const tryFocus = (select: boolean) => {
    if (done) return;
    const before = document.activeElement;
    form.setFocus(path, select ? { shouldSelect: true } : undefined);
    // activeElement changed → focus succeeded
    if (document.activeElement !== before) {
      done = true;
    }
  };

  FOCUS_RETRY_DELAYS_MS.forEach((delay) => {
    const isFirst = delay === 0;
    const run = () => tryFocus(isFirst && shouldSelectOnFirst);
    if (isFirst) {
      queueMicrotask(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(run);
        });
      });
      return;
    }
    window.setTimeout(run, delay);
  });
}

/** focus quantity after picking a line item (VirtualSelect suppresses radix refocus; timing is still flaky with one frame) */
export function scheduleQuantityFocusAfterItemSelect<T extends FieldValues>(
  form: UseFormReturn<T>,
  rowIndex: number,
): void {
  const path = `invoiceItems.${rowIndex}.quantity` as SetFocusPath<T>;
  scheduleFocusWithRetries(form, path, true);
}

/**
 * Focus item VirtualSelect on a new row after append.
 *
 * `form.setFocus` often fails for VirtualSelect fields because the trigger element is
 * registered through `triggerRef={field.ref}` (not native `{...field}`), which RHF may
 * not wire into `_fields` the same way.  We try `setFocus` first then fall back to a
 * direct DOM query for the trigger input in the target row.
 */
export function scheduleItemFieldFocusAfterNewRow<T extends FieldValues>(
  form: UseFormReturn<T>,
  rowIndex: number,
): void {
  const path = `invoiceItems.${rowIndex}.inventoryId` as SetFocusPath<T>;
  let done = false;
  let target: HTMLElement | null = null;

  /** find the item-selector input for this row — works in both virtual and non-virtual tables */
  const findItemInput = (): HTMLInputElement | null => {
    // virtual mode: react-virtuoso sets data-index on each <tr>
    const row =
      document.querySelector(`tr[data-index="${rowIndex}"]`) ??
      // non-virtual fallback: sequential row position
      document.querySelectorAll('table tbody > tr')[rowIndex];
    if (!row) return null;
    return row.querySelector(
      'input[autocomplete="off"]:not([type="number"]):not([type="hidden"])',
    );
  };

  const tryFocus = () => {
    if (done) return;

    // 1. Try RHF setFocus
    const before = document.activeElement;
    form.setFocus(path);
    if (document.activeElement !== before) {
      target = document.activeElement as HTMLElement;
    }

    // 2. Fallback: DOM query
    if (!target) {
      const input = findItemInput();
      if (input) {
        input.focus();
        if (document.activeElement === input) {
          target = input;
        }
      }
    }

    if (!target) return;
    done = true;
  };

  // Re-renders after append unmount+remount VirtualSelect trigger input.
  // Guard re-acquires the replacement element and re-applies focus.
  const guardUntil = Date.now() + 1500;
  const guard = () => {
    if (Date.now() > guardUntil) return;
    if (target && !target.isConnected) {
      // element was replaced by re-render — find new one
      const fresh = findItemInput();
      if (fresh) {
        fresh.focus();
        target = fresh;
      }
      return;
    }
    if (target && document.activeElement !== target) {
      target.focus();
    }
  };

  // Initial focus attempts via retries
  FOCUS_RETRY_DELAYS_MS.forEach((delay) => {
    const isFirst = delay === 0;
    const run = () => {
      tryFocus();
      guard();
    };
    if (isFirst) {
      queueMicrotask(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(run);
        });
      });
      return;
    }
    window.setTimeout(run, delay);
  });

  // Extended guard: re-renders can disconnect element well after initial focus
  window.setTimeout(guard, 800);
  window.setTimeout(guard, 1200);
}

/** focus date after party/section customer pick; no shouldSelect — trigger is a button */
export function scheduleDateFieldFocusAfterPartySelect<T extends FieldValues>(
  form: UseFormReturn<T>,
): void {
  let done = false;
  queueMicrotask(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (done) return;
        const before = document.activeElement;
        form.setFocus('date' as SetFocusPath<T>);
        if (document.activeElement !== before) {
          done = true;
        }
      });
    });
  });
}
