import { renderHook } from '@testing-library/react';
import { useCmdOrCtrlShortcut } from '../useCmdOrCtrlShortcut';

describe('useCmdOrCtrlShortcut', () => {
  it('triggers onAction on Meta + key', () => {
    const onAction = jest.fn();
    renderHook(() => useCmdOrCtrlShortcut('s', onAction));

    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('triggers onAction on Ctrl + uppercase key', () => {
    const onAction = jest.fn();
    renderHook(() => useCmdOrCtrlShortcut('n', onAction));

    const event = new KeyboardEvent('keydown', {
      key: 'N',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('does not crash or trigger onAction when e.key is undefined', () => {
    const onAction = jest.fn();
    renderHook(() => useCmdOrCtrlShortcut('s', onAction));

    // Simulate keydown event where e.key is undefined
    const event = new KeyboardEvent('keydown', {
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'key', { value: undefined });

    expect(() => window.dispatchEvent(event)).not.toThrow();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('does not trigger onAction when altKey is pressed', () => {
    const onAction = jest.fn();
    renderHook(() => useCmdOrCtrlShortcut('s', onAction));

    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(onAction).not.toHaveBeenCalled();
  });

  it('respects shiftKey configuration', () => {
    const onAction = jest.fn();
    renderHook(() => useCmdOrCtrlShortcut('p', onAction, true));

    // without shiftKey -> should not trigger
    const withoutShift = new KeyboardEvent('keydown', {
      key: 'p',
      metaKey: true,
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(withoutShift);
    expect(onAction).not.toHaveBeenCalled();

    // with shiftKey -> should trigger
    const withShift = new KeyboardEvent('keydown', {
      key: 'p',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(withShift);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
