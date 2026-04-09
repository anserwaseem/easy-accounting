import type { FieldValues, UseFormReturn } from 'react-hook-form';

/** second pass: radix + item cell re-render can steal focus after one rAF */
const QUANTITY_FOCUS_RETRY_MS = 150;

type SetFocusPath<T extends FieldValues> = Parameters<
  UseFormReturn<T>['setFocus']
>[0];

/** focus quantity after picking a line item (VirtualSelect suppresses radix refocus; timing is still flaky with one frame) */
export function scheduleQuantityFocusAfterItemSelect<T extends FieldValues>(
  form: UseFormReturn<T>,
  rowIndex: number,
): void {
  const path = `invoiceItems.${rowIndex}.quantity` as SetFocusPath<T>;
  const run = () => {
    form.setFocus(path, { shouldSelect: true });
  };
  requestAnimationFrame(run);
  window.setTimeout(run, QUANTITY_FOCUS_RETRY_MS);
}

/** focus date after party/section customer pick; no shouldSelect — trigger is a button */
export function scheduleDateFieldFocusAfterPartySelect<T extends FieldValues>(
  form: UseFormReturn<T>,
): void {
  queueMicrotask(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        form.setFocus('date' as SetFocusPath<T>);
      });
    });
  });
}
