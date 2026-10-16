import { renderHook } from '@testing-library/react';
import { useEscapeKey } from '../useEscapeKey';

describe('useEscapeKey', () => {
  it('triggers onEscape on Escape keydown', () => {
    const onEscape = jest.fn();
    renderHook(() => useEscapeKey(onEscape));

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('does not trigger onEscape when disabled', () => {
    const onEscape = jest.fn();
    renderHook(() => useEscapeKey(onEscape, false));

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(onEscape).not.toHaveBeenCalled();
  });

  it('does not trigger onEscape when a modifier key is pressed', () => {
    const onEscape = jest.fn();
    renderHook(() => useEscapeKey(onEscape));

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(onEscape).not.toHaveBeenCalled();
  });

  it('does not trigger onEscape when a dialog is open in the DOM', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);

    try {
      const onEscape = jest.fn();
      renderHook(() => useEscapeKey(onEscape));

      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);

      expect(onEscape).not.toHaveBeenCalled();
    } finally {
      dialog.remove();
    }
  });

  it('invokes updated onEscape on rerender without re-adding window listener', () => {
    const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
    const escape1 = jest.fn();
    const escape2 = jest.fn();

    const { rerender } = renderHook(({ handler }) => useEscapeKey(handler), {
      initialProps: { handler: escape1 },
    });

    const initialAddCount = addEventListenerSpy.mock.calls.length;

    rerender({ handler: escape2 });

    expect(addEventListenerSpy.mock.calls.length).toBe(initialAddCount);

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(escape1).not.toHaveBeenCalled();
    expect(escape2).toHaveBeenCalledTimes(1);

    addEventListenerSpy.mockRestore();
  });
});
