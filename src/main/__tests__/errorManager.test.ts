import log from 'electron-log';
import { dialog } from 'electron';
import { ErrorManager } from '../errorManager';

jest.mock('electron-log', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  transports: {
    file: { level: 'info' },
    console: { level: 'info' },
  },
}));

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mocked/userData'),
    name: 'easy-accounting',
    getVersion: jest.fn(() => '0.2.21'),
    isReady: jest.fn(() => true),
    on: jest.fn(),
    relaunch: jest.fn(),
  },
  dialog: {
    showMessageBox: jest.fn().mockResolvedValue({ response: 0 }),
  },
  shell: {
    showItemInFolder: jest.fn(),
  },
}));

jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
}));

describe('ErrorManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isTransientNetworkError', () => {
    it('identifies chromium net::ERR_* errors as transient network errors', () => {
      expect(
        ErrorManager.isTransientNetworkError(
          new Error('net::ERR_NETWORK_CHANGED'),
        ),
      ).toBe(true);
      expect(
        ErrorManager.isTransientNetworkError(
          new Error('net::ERR_INTERNET_DISCONNECTED'),
        ),
      ).toBe(true);
      expect(
        ErrorManager.isTransientNetworkError(
          new Error('net::ERR_CONNECTION_RESET'),
        ),
      ).toBe(true);
      expect(
        ErrorManager.isTransientNetworkError(
          new Error('net::ERR_CONNECTION_TIMED_OUT'),
        ),
      ).toBe(true);
      expect(
        ErrorManager.isTransientNetworkError(
          new Error('net::ERR_NAME_NOT_RESOLVED'),
        ),
      ).toBe(true);
    });

    it('identifies node network error codes as transient network errors', () => {
      const econnreset = new Error('read ECONNRESET');
      (econnreset as { code?: string }).code = 'ECONNRESET';
      expect(ErrorManager.isTransientNetworkError(econnreset)).toBe(true);

      const etimedout = new Error('connect ETIMEDOUT');
      (etimedout as { code?: string }).code = 'ETIMEDOUT';
      expect(ErrorManager.isTransientNetworkError(etimedout)).toBe(true);

      const enotfound = new Error('getaddrinfo ENOTFOUND api.github.com');
      (enotfound as { code?: string }).code = 'ENOTFOUND';
      expect(ErrorManager.isTransientNetworkError(enotfound)).toBe(true);
    });

    it('returns false for non-network errors', () => {
      expect(
        ErrorManager.isTransientNetworkError(
          new TypeError('Cannot read properties of undefined'),
        ),
      ).toBe(false);
      expect(
        ErrorManager.isTransientNetworkError(
          new Error('Database disk image is malformed'),
        ),
      ).toBe(false);
      expect(ErrorManager.isTransientNetworkError(null)).toBe(false);
      expect(ErrorManager.isTransientNetworkError(undefined)).toBe(false);
    });
  });

  describe('handleException', () => {
    it('silently ignores transient network errors without fatal dialog', () => {
      const errorManager = new ErrorManager();
      const networkError = new Error('net::ERR_NETWORK_CHANGED');

      const handledAsFatal = errorManager.handleException(networkError);

      expect(handledAsFatal).toBe(false);
      expect(log.warn).toHaveBeenCalledWith(
        'Ignored transient network error:',
        networkError,
      );
      expect(log.error).not.toHaveBeenCalled();
      expect(dialog.showMessageBox).not.toHaveBeenCalled();
    });

    it('treats regular errors as uncaught fatal errors', () => {
      const errorManager = new ErrorManager();
      const fatalError = new Error('Unexpected crash in main process');

      const handledAsFatal = errorManager.handleException(fatalError);

      expect(handledAsFatal).toBe(true);
      expect(log.error).toHaveBeenCalledWith('Uncaught exception:', fatalError);
    });
  });
});
