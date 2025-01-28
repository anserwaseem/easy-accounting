import {
  app,
  Menu,
  shell,
  BrowserWindow,
  MenuItemConstructorOptions,
  dialog,
} from 'electron';
import log from 'electron-log';
import type { BackupReadResult } from '@/types';
import { AppUpdater } from './appUpdater';
import { BackupService } from './services/Backup.service';
import { store } from './store';

interface DarwinMenuItemConstructorOptions extends MenuItemConstructorOptions {
  selector?: string;
  submenu?: DarwinMenuItemConstructorOptions[] | Menu;
}

export default class MenuBuilder {
  mainWindow: BrowserWindow;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.setupMenuRefresh();
  }

  async buildMenu(): Promise<Menu> {
    const template = await this.getTemplate();
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
    return menu;
  }

  private async getTemplate(): Promise<MenuItemConstructorOptions[]> {
    if (process.platform === 'darwin') {
      return this.getDarwinTemplate();
    }
    return this.getDefaultTemplate();
  }

  private async getDarwinTemplate(): Promise<MenuItemConstructorOptions[]> {
    return [
      MenuBuilder.getAboutMenu('Easy Accounting'),
      MenuBuilder.getEditMenu(),
      this.getViewMenu(),
      MenuBuilder.getWindowMenu(),
      MenuBuilder.getHelpMenu(),
      await this.getBackupMenu(),
    ];
  }

  private async getDefaultTemplate(): Promise<MenuItemConstructorOptions[]> {
    return [
      this.getFileMenu(),
      this.getViewMenu(),
      MenuBuilder.getHelpMenu(),
      await this.getBackupMenu(),
    ];
  }

  private static getAboutMenu(
    appName: string,
  ): DarwinMenuItemConstructorOptions {
    return {
      label: appName,
      submenu: [
        {
          label: `About ${appName}`,
          selector: 'orderFrontStandardAboutPanel:',
        },
        { type: 'separator' },
        { label: 'Services', submenu: [] },
        { type: 'separator' },
        {
          label: `Hide ${appName}`,
          accelerator: 'Command+H',
          selector: 'hide:',
        },
        {
          label: 'Hide Others',
          accelerator: 'Command+Shift+H',
          selector: 'hideOtherApplications:',
        },
        { label: 'Show All', selector: 'unhideAllApplications:' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Command+Q', click: () => app.quit() },
      ],
    };
  }

  private static getEditMenu(): DarwinMenuItemConstructorOptions {
    return {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'Command+Z', selector: 'undo:' },
        { label: 'Redo', accelerator: 'Shift+Command+Z', selector: 'redo:' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'Command+X', selector: 'cut:' },
        { label: 'Copy', accelerator: 'Command+C', selector: 'copy:' },
        { label: 'Paste', accelerator: 'Command+V', selector: 'paste:' },
        {
          label: 'Select All',
          accelerator: 'Command+A',
          selector: 'selectAll:',
        },
      ],
    };
  }

  private static getWindowMenu(): DarwinMenuItemConstructorOptions {
    return {
      label: 'Window',
      submenu: [
        {
          label: 'Minimize',
          accelerator: 'Command+M',
          selector: 'performMiniaturize:',
        },
        { label: 'Close', accelerator: 'Command+W', selector: 'performClose:' },
        { type: 'separator' },
        { label: 'Bring All to Front', selector: 'arrangeInFront:' },
      ],
    };
  }

  private static getHelpMenu(): MenuItemConstructorOptions {
    return {
      label: 'Help',
      submenu: [
        {
          label: 'Contact',
          click() {
            shell.openExternal('mailto:hafiz.anser.waseem@gmail.com');
          },
        },
        {
          label: 'File an Issue',
          click() {
            shell.openExternal(
              'https://github.com/anserwaseem/easy-accounting/issues',
            );
          },
        },
        {
          label: 'Check for Updates',
          click: () => {
            AppUpdater.checkForUpdates();
          },
        },
        {
          label: 'Show logs',
          click() {
            shell.showItemInFolder(log.transports.file.getFile().path);
          },
        },
      ],
    };
  }

  private getViewMenu(): DarwinMenuItemConstructorOptions {
    return {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: process.platform === 'darwin' ? 'Command+R' : 'Ctrl+R',
          click: () => this.mainWindow.webContents.reload(),
        },
        {
          label: 'Toggle Full Screen',
          accelerator: process.platform === 'darwin' ? 'Ctrl+Command+F' : 'F11',
          click: () =>
            this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen()),
        },
        {
          label: 'Toggle Developer Tools',
          accelerator:
            process.platform === 'darwin' ? 'Alt+Command+I' : 'Alt+Ctrl+I',
          click: () => this.mainWindow.webContents.toggleDevTools(),
        },
      ],
    };
  }

  private getFileMenu(): MenuItemConstructorOptions {
    return {
      label: '&File',
      submenu: [
        { label: '&Open', accelerator: 'Ctrl+O' },
        {
          label: '&Close',
          accelerator: 'Ctrl+W',
          click: () => this.mainWindow.close(),
        },
      ],
    };
  }

  private async getBackupMenu(): Promise<MenuItemConstructorOptions> {
    const backupService = new BackupService();
    const backups = await backupService.listBackups();

    return {
      label: 'Backup',
      submenu: [
        {
          label: 'Create Backup',
          click: () =>
            this.handleBackupOperation(
              () => backupService.createBackup(),
              true,
            ),
        },
        { type: 'separator' },
        {
          label: 'Restore Last Backup',
          enabled: backups.length > 0,
          click: async () => {
            const { response } = await dialog.showMessageBox(this.mainWindow, {
              type: 'warning',
              buttons: ['Yes', 'No'],
              title: 'Confirm Restore',
              message:
                'Are you sure? This will replace your current database and restart the application.',
            });

            if (response === 0) {
              this.handleBackupOperation(() =>
                backupService.restoreLastBackup(),
              );
            }
          },
        },
        {
          label: 'Available Backups',
          submenu: backups.map((backup) => ({
            label: `${new Date(backup.timestamp).toLocaleString()} - ${
              backup.size / 1024
            } KB - ${backup.type}`,
            click: async () => {
              const dateString = backup.filename
                .replace('database-backup-', '')
                .replace('.db', '');
              const { response } = await dialog.showMessageBox(
                this.mainWindow,
                {
                  type: 'warning',
                  buttons: ['Yes', 'No'],
                  title: 'Confirm Restore',
                  message: `Restore backup from ${new Date(
                    backup.timestamp,
                  ).toLocaleString()}? \nThis will replace your current database and restart the application.`,
                },
              );

              if (response === 0) {
                this.handleBackupOperation(() =>
                  backupService.restoreFromDate(dateString),
                );
              }
            },
          })),
        },
      ],
    };
  }

  private async handleBackupOperation(
    operation: () => Promise<BackupReadResult>,
    isCreate = false,
  ) {
    const result = await operation();
    if (!result.success) {
      dialog.showErrorBox(
        'Backup operation failed',
        result.error || 'Unknown error',
      );
    } else if (isCreate) {
      this.mainWindow.webContents.reload();
      // Rebuild menu to show updated backup list
      this.buildMenu();
    } else {
      app.hide();
      app.relaunch();
      app.exit();
    }
  }

  private setupMenuRefresh(): void {
    // Refresh menu when user auth state changes
    store.onDidChange('username', async (newValue, oldValue) => {
      log.info(
        `Menu: store.onDidChange invoked for "username" key - newValue: ${newValue}, oldValue: ${oldValue}`,
      );
      await this.buildMenu();
    });
  }
}
