/**
 * @jest-environment jsdom
 *
 * The failure this guards against does not look like a bug: the app renders
 * perfectly and ignores every click, so it reads as a hang and the only way out
 * is quitting. It happened in the real app after toggling a checkbox in a
 * dialog that itself contains a ConfirmDialog.
 */
import { render } from '@testing-library/react';
import { Dialog } from '../dialog';

const lock = () => {
  document.body.style.pointerEvents = 'none';
};
const locked = () => document.body.style.pointerEvents === 'none';

describe('Dialog body-lock guard', () => {
  beforeEach(() => {
    document.body.style.pointerEvents = '';
    document.body.innerHTML = '';
  });

  it('clears a lock left behind when the dialog is closed', async () => {
    const { rerender } = render(<Dialog open>{null}</Dialog>);
    lock();
    rerender(<Dialog open={false}>{null}</Dialog>);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(locked()).toBe(false);
  });

  it('leaves the lock alone while a dialog is still open', async () => {
    // a nested dialog closing must not unlock the page under the one still up
    document.body.innerHTML =
      '<div role="dialog" data-state="open">still here</div>';
    const { rerender } = render(<Dialog open>{null}</Dialog>);
    lock();
    rerender(<Dialog open={false}>{null}</Dialog>);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(locked()).toBe(true);
  });

  it('does not touch the body while open', async () => {
    render(<Dialog open>{null}</Dialog>);
    lock();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(locked()).toBe(true);
  });

  it('leaves an unlocked body unlocked', async () => {
    const { rerender } = render(<Dialog open>{null}</Dialog>);
    rerender(<Dialog open={false}>{null}</Dialog>);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(document.body.style.pointerEvents).toBe('');
  });
});
