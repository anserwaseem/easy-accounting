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

  it('invokes updated onAction after rerender without re-adding window listener', () => {
    const addEventListenerSpy = jest.spyOn(window, 'addEventListener');
    const action1 = jest.fn();
    const action2 = jest.fn();

    const { rerender } = renderHook(
      ({ action }) => useCmdOrCtrlShortcut('s', action),
      { initialProps: { action: action1 } },
    );

    const initialAddCount = addEventListenerSpy.mock.calls.length;

    // Rerender with a new callback function
    rerender({ action: action2 });

    // Listener count should remain unchanged (no re-binding on callback change)
    expect(addEventListenerSpy.mock.calls.length).toBe(initialAddCount);

    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(action1).not.toHaveBeenCalled();
    expect(action2).toHaveBeenCalledTimes(1);

    addEventListenerSpy.mockRestore();
  });
});
