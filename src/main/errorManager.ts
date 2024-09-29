import fs from 'fs';
import os from 'os';
import path from 'path';
import log from 'electron-log';
import { app, dialog, shell } from 'electron';

export class ErrorManager {
  private errorLogPath: string;

  constructor() {
    this.errorLogPath = app.getPath('userData');
  }

  public init(): void {
    process.on('unhandledRejection', this.handleUncaughtException);
    process.on('uncaughtException', this.handleUncaughtException);
  }

  private handleUncaughtException = (err: Error): void => {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    log.error('Uncaught exception:', err);

    if (app.isReady()) {
      this.showExceptionDialog(err);
    } else {
      app.on('ready', () => {
        this.showExceptionDialog(err);
      });
    }
  };

  private showExceptionDialog = (err: Error): void => {
    const file = this.writeErrorToFile(err);

    // eslint-disable-next-line promise/no-promise-in-callback
    dialog
      .showMessageBox({
        type: 'error',
        title: app.name,
        message: ErrorManager.formatErrorMessage(err),
        buttons: ['OK', 'Show Details', 'Restart App'],
        defaultId: 2, // 'Restart App' is the default action
        noLink: true,
      })
      .then(({ response }) => {
        ErrorManager.handleDialogResponse(response, file);
      })
      .catch((e) => log.error('Error in dialog handling:', e));
  };

  private writeErrorToFile(err: Error): string {
    const file = path.join(
      this.errorLogPath,
      `uncaughtException-${Date.now()}.txt`,
    );
    const report = ErrorManager.createErrorReport(err);
    fs.writeFileSync(file, report.replace(/\n/g, os.EOL));
    return file;
  }

  private static formatErrorMessage(err: Error): string {
    return `${app.name} encountered an unexpected error. Click "Show Details" for more information or "Restart App" to relaunch the application.\n\nError details: ${err.message}`;
  }

  private static handleDialogResponse(response: number, file: string): void {
    switch (response) {
      case 1: // 'Show Details'
        shell.showItemInFolder(file);
        break;
      case 2: // 'Restart App'
        app.relaunch();
        break;
      default:
        break;
    }
  }

  private static createErrorReport(err: Error): string {
    return (
      `Application: ${app.name} ${app.getVersion()}\n` +
      `Platform: ${os.type()} ${os.release()} ${os.arch()}\n` +
      `${err.stack}`
    );
  }
}
