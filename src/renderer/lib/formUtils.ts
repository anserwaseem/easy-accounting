import type { KeyboardEvent } from 'react';

/** block accidental form submit on Enter while keeping native behavior for real controls */
export const handleFormEnterKeyDown = (
  e: KeyboardEvent<HTMLFormElement> | undefined,
): void => {
  if (!e || e.key !== 'Enter') return;
  const target = e.target as HTMLElement;
  if (target.closest('button')) return;
  if (target.closest('[role="button"]')) return;
  if (target instanceof HTMLAnchorElement && target.getAttribute('href'))
    return;
  if (target instanceof HTMLTextAreaElement) return;
  if (target instanceof HTMLInputElement) {
    const t = target.type;
    if (
      t === 'submit' ||
      t === 'button' ||
      t === 'reset' ||
      t === 'checkbox' ||
      t === 'radio'
    ) {
      return;
    }
  }
  e.preventDefault();
};
