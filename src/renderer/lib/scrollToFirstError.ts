/**
 * Scrolls the first field that failed validation into view.
 *
 * React Hook Form focuses the first invalid field by default, but on a
 * long form (an invoice with many line items, a journal with many
 * entries) the field can be far below the fold — and on a phone the
 * focus alone scrolls the *window* to a position that leaves the field
 * behind the keyboard. This scrolls the field's own scroll container to
 * it and puts the caret in it.
 *
 * The field is found through the `aria-invalid` marker that
 * `FormControl` (src/renderer/shad/ui/form.tsx) already sets on the
 * control itself, so no extra wiring is needed at each call site.
 */
export const scrollToFirstInvalidField = (): void => {
  const invalid = document.querySelector<HTMLElement>(
    '[aria-invalid="true"]:not([aria-invalid="false"])',
  );
  if (!invalid) return;

  invalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (typeof invalid.focus === 'function') {
    // preventScroll: the smooth scroll above is the movement we want.
    invalid.focus({ preventScroll: true });
  }
};

/**
 * Flattens a react-hook-form error object into a list of field names,
 * so a caller can report which field failed.
 */
export const collectErrorFieldNames = (
  errors: unknown,
  prefix = '',
): string[] => {
  if (!errors || typeof errors !== 'object') return [];
  const names: string[] = [];
  for (const [key, value] of Object.entries(
    errors as Record<string, unknown>,
  )) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      value &&
      typeof value === 'object' &&
      'message' in (value as Record<string, unknown>)
    ) {
      names.push(path);
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        names.push(...collectErrorFieldNames(entry, `${path}.${index}`));
      });
      continue;
    }
    names.push(...collectErrorFieldNames(value, path));
  }
  return names;
};
