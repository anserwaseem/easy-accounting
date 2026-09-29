import { EventEmitter } from 'events';
import { BrowserWindow, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { AppUpdater } from '../appUpdater';

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
  dialog: {
    showMessageBox: jest.fn(),
  },
}));

const mockEmitter = new EventEmitter();

jest.mock('electron-updater', () => ({
  autoUpdater: {
    logger: null,
    autoDownload: false,
    on: jest.fn((event: string, listener: (...args: unknown[]) => void) => {
      mockEmitter.on(event, listener);
    }),
    emit: jest.fn((event: string, ...args: unknown[]) => {
      return mockEmitter.emit(event, ...args);
    }),
    checkForUpdates: jest.fn(),
    downloadUpdate: jest.fn(),
    quitAndInstall: jest.fn(),
  },
}));

describe('AppUpdater', () => {
  let mockWindow: BrowserWindow;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmitter.removeAllListeners();

    mockWindow = {
      isDestroyed: jest.fn(() => false),
      webContents: {
        send: jest.fn(),
      },
      setProgressBar: jest.fn(),
    } as unknown as BrowserWindow;

    // eslint-disable-next-line no-new
    new AppUpdater(mockWindow);
  });

  describe('background update check', () => {
    it('does not show dialog when update check fails due to network error', async () => {
      const networkError = new Error('net::ERR_NETWORK_CHANGED');
      (autoUpdater.checkForUpdates as jest.Mock).mockRejectedValueOnce(
        networkError,
      );

      await expect(AppUpdater.checkForUpdates(false)).resolves.not.toThrow();

      // emit error event from updater
      mockEmitter.emit('error', networkError);

      expect(dialog.showMessageBox).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(
        'AutoUpdater check failed:',
        networkError,
      );
      expect(log.warn).toHaveBeenCalledWith(
        'Auto-updater error:',
        networkError,
      );
    });

    it('does not show dialog when no update is available in background', async () => {
      (autoUpdater.checkForUpdates as jest.Mock).mockResolvedValueOnce(null);

      await AppUpdater.checkForUpdates(false);
      mockEmitter.emit('update-not-available');

      expect(dialog.showMessageBox).not.toHaveBeenCalled();
    });

    it('prompts user when update is available in background', async () => {
      (dialog.showMessageBox as jest.Mock).mockResolvedValueOnce({
        response: 1, // clicked 'No'
      });

      await AppUpdater.checkForUpdates(false);
      mockEmitter.emit('update-available', { version: '0.2.22' });

      expect(dialog.showMessageBox).toHaveBeenCalledWith(
        mockWindow,
        expect.objectContaining({
          type: 'question',
          title: 'Update Available',
          message:
            'Version 0.2.22 is available. Would you like to download it now?',
        }),
      );
      expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    });
  });

  describe('manual update check', () => {
    it('shows error dialog when manual update check fails', async () => {
      (dialog.showMessageBox as jest.Mock).mockResolvedValueOnce({
        response: 0,
      });
      (autoUpdater.checkForUpdates as jest.Mock).mockResolvedValueOnce(null);

      await AppUpdater.checkForUpdates(true);

      const checkError = new Error('net::ERR_INTERNET_DISCONNECTED');
      mockEmitter.emit('error', checkError);

      expect(dialog.showMessageBox).toHaveBeenCalledWith(
        mockWindow,
        expect.objectContaining({
          type: 'error',
          title: 'Update Error',
          message:
            'An error occurred while checking for updates: net::ERR_INTERNET_DISCONNECTED',
        }),
      );
    });

    it('shows info dialog when no update is available on manual check', async () => {
      (dialog.showMessageBox as jest.Mock).mockResolvedValueOnce({
        response: 0,
      });
      (autoUpdater.checkForUpdates as jest.Mock).mockResolvedValueOnce(null);

      await AppUpdater.checkForUpdates(true);
      mockEmitter.emit('update-not-available');

      expect(dialog.showMessageBox).toHaveBeenCalledWith(
        mockWindow,
        expect.objectContaining({
          type: 'info',
          title: 'No Updates',
          message: 'You are using the latest version of easy-accounting.',
        }),
      );
    });
  });

  describe('downloading update', () => {
    it('initiates download when user accepts available update and alerts on download failure', async () => {
      (dialog.showMessageBox as jest.Mock)
        .mockResolvedValueOnce({ response: 0 }) // accepts download
        .mockResolvedValueOnce({ response: 1 }); // cancels on download error

      mockEmitter.emit('update-available', { version: '0.2.22' });
      await Promise.resolve();

      expect(autoUpdater.downloadUpdate).toHaveBeenCalled();

      // simulate error while downloading
      const downloadError = new Error('Connection closed');
      mockEmitter.emit('error', downloadError);

      expect(dialog.showMessageBox).toHaveBeenLastCalledWith(
        mockWindow,
        expect.objectContaining({
          type: 'error',
          title: 'Download Error',
          message:
            'An error occurred while downloading update: Connection closed',
        }),
      );
    });
  });
});
