import { BrowserWindow, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

export class AppUpdater {
  constructor(private mainWindow: BrowserWindow) {
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
      this.sendStatusToWindow('Update available.');
      dialog
        .showMessageBox(this.mainWindow, {
          type: 'info',
          title: 'Update Available',
          message: `Version ${info.version} is available. Would you like to download it now?`,
          buttons: ['Yes', 'No'],
        })
        .then((result) => {
          if (result.response === 0) {
            autoUpdater.downloadUpdate();
          }
        })
        .catch((reason) => this.sendStatusToWindow(reason));
    });

    autoUpdater.on('update-not-available', () => {
      this.sendStatusToWindow('Update not available.');
    });

    autoUpdater.on('error', (err) => {
      this.sendStatusToWindow(`Error in auto-updater. ${err}`);
    });

    autoUpdater.on('download-progress', (progressObj) => {
      const logMessage = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
      this.sendStatusToWindow(logMessage);
    });

    autoUpdater.on('update-downloaded', () => {
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
    this.mainWindow.webContents.send('update-message', text);
  }

  static checkForUpdates() {
    autoUpdater.checkForUpdates();
  }
}
