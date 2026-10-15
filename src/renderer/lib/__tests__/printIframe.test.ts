import { printHtmlInHiddenIframe } from '../printIframe';

describe('printHtmlInHiddenIframe', () => {
  let writtenHtml: string;
  let printMock: jest.Mock;
  let focusMock: jest.Mock;
  let removeMock: jest.Mock;
  let listeners: Record<string, EventListener>;
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    writtenHtml = '';
    printMock = jest.fn();
    focusMock = jest.fn();
    removeMock = jest.fn();
    listeners = {};
    jest.useFakeTimers();

    const fakeDoc = {
      open: jest.fn(),
      write: (html: string) => {
        writtenHtml = html;
      },
      close: jest.fn(),
      body: { innerHTML: 'initial' },
    };

    const fakeWin = {
      addEventListener: jest.fn((event: string, fn: EventListener) => {
        listeners[event] = fn;
      }),
      removeEventListener: jest.fn((event: string) => {
        delete listeners[event];
      }),
      focus: focusMock,
      print: printMock,
    };

    jest.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'iframe') {
        return originalCreateElement(tag);
      }
      return {
        setAttribute: jest.fn(),
        style: {},
        contentDocument: fakeDoc,
        contentWindow: fakeWin,
        remove: removeMock,
        src: '',
      } as unknown as HTMLIFrameElement;
    }) as typeof document.createElement);

    jest.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('creates iframe, writes html, and calls print on next tick', () => {
    printHtmlInHiddenIframe('<html><body>Test Print</body></html>');

    expect(writtenHtml).toContain('Test Print');
    expect(printMock).not.toHaveBeenCalled();

    jest.advanceTimersByTime(0);

    expect(focusMock).toHaveBeenCalled();
    expect(printMock).toHaveBeenCalled();
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('cleans up iframe and listeners when afterprint fires', () => {
    printHtmlInHiddenIframe('<html><body>Test Print</body></html>');
    jest.advanceTimersByTime(0);

    expect(listeners.afterprint).toBeDefined();

    // simulate afterprint event
    listeners.afterprint(new Event('afterprint'));

    expect(removeMock).toHaveBeenCalled();
    expect(listeners.afterprint).toBeUndefined();
  });

  it('cleans up iframe on fallback timeout if afterprint does not fire', () => {
    printHtmlInHiddenIframe('<html><body>Test Print</body></html>', {
      fallbackTimeoutMs: 5000,
    });
    jest.advanceTimersByTime(0);

    expect(removeMock).not.toHaveBeenCalled();

    jest.advanceTimersByTime(5000);

    expect(removeMock).toHaveBeenCalled();
  });

  it('cancels and cleans previous session if print is called again before cleanup', () => {
    printHtmlInHiddenIframe('<html><body>First</body></html>');
    expect(removeMock).not.toHaveBeenCalled();

    printHtmlInHiddenIframe('<html><body>Second</body></html>');
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(writtenHtml).toContain('Second');
  });
});
