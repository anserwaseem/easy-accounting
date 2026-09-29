import { BrowserWindow, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

interface ActiveUpdaterState {
  isManualCheck: boolean;
}

let activeUpdater: ActiveUpdaterState | null = null;

export class AppUpdater {
  public isManualCheck = false;

  private isDownloading = false;

  constructor(private mainWindow: BrowserWindow) {
    activeUpdater = this;
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.autoDownload = false;

    this.initializeAutoUpdater();
  }

  private initializeAutoUpdater() {
    autoUpdater.on('checking-for-update', () => {
      this.sendStatusToWindow('Checking for update...');
    });

    autoUpdater.on('update-available', (info) => {
      this.isManualCheck = false;
      this.sendStatusToWindow('Update available.');
      dialog
        .showMessageBox(this.mainWindow, {
          type: 'question',
          title: 'Update Available',
          message: `Version ${info.version} is available. Would you like to download it now?`,
          buttons: ['Yes', 'No'],
        })
        .then((result) => {
          if (result.response === 0) {
            this.isDownloading = true;
            autoUpdater.downloadUpdate();
          }
        })
        .catch((reason) => this.sendStatusToWindow(reason));
    });

    autoUpdater.on('update-not-available', () => {
      this.sendStatusToWindow('Update not available.');
      if (this.isManualCheck) {
        this.isManualCheck = false;
        dialog
          .showMessageBox(this.mainWindow, {
            type: 'info',
            title: 'No Updates',
            message: 'You are using the latest version of easy-accounting.',
            buttons: ['OK'],
          })
          .catch((reason) => this.sendStatusToWindow(reason));
      }
    });

    autoUpdater.on('error', (err) => {
      this.sendStatusToWindow(`Error in auto-updater. ${err}`);
      log.warn('Auto-updater error:', err);

      const hadManualCheck = this.isManualCheck;
      this.isManualCheck = false;

      // if user was actively downloading an update and it failed, notify them
      if (this.isDownloading) {
        // eslint-disable-next-line promise/no-promise-in-callback
        dialog
          .showMessageBox(this.mainWindow, {
            type: 'error',
            title: 'Download Error',
            message: `An error occurred while downloading update: ${err.message}`,
            buttons: ['Retry', 'Cancel'],
          })
          .then((result) => {
            if (result.response === 0) {
              autoUpdater.downloadUpdate();
            } else {
              this.isDownloading = false;
            }
          })
          .catch((reason) => this.sendStatusToWindow(reason));
        return;
      }

      // if check was explicitly triggered by the user via menu, notify them
      if (hadManualCheck) {
        // eslint-disable-next-line promise/no-promise-in-callback
        dialog
          .showMessageBox(this.mainWindow, {
            type: 'error',
            title: 'Update Error',
            message: `An error occurred while checking for updates: ${err.message}`,
            buttons: ['OK'],
          })
          .catch((reason) => this.sendStatusToWindow(reason));
      }

      // background periodic check failures (e.g. offline, net::ERR_NETWORK_CHANGED)
      // are logged quietly without interrupting shop users with modal popups
    });

    autoUpdater.on('download-progress', (progressObj) => {
      const logMessage = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;

      const progress = Math.floor(progressObj.percent) / 100;
      if (this.mainWindow.isDestroyed()) {
        return;
      }
      if (progress < 1) {
        this.mainWindow.setProgressBar(progress);
      } else {
        this.mainWindow.setProgressBar(-0.15); // reset to a bit less than 0 to show reset state
      }

      this.sendStatusToWindow(logMessage);
    });

    autoUpdater.on('update-downloaded', () => {
      this.isDownloading = false;
      this.sendStatusToWindow('Update downloaded');
      dialog
        .showMessageBox(this.mainWindow, {
          type: 'info',
          title: 'Update Ready',
          message:
            'Update downloaded. The application will now restart to install the update.',
          buttons: ['Restart'],
        })
        .then(() => {
          autoUpdater.quitAndInstall();
        })
        .catch((reason) => this.sendStatusToWindow(reason));
    });
  }

  private sendStatusToWindow(text: string) {
    log.info(text);
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('update-message', text);
    }
  }

  static async checkForUpdates(manual = false): Promise<void> {
    if (activeUpdater) {
      activeUpdater.isManualCheck = manual;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      log.warn('AutoUpdater check failed:', err);
    }
  }
}
