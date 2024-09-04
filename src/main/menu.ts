import {
  app,
  Menu,
  shell,
  BrowserWindow,
  MenuItemConstructorOptions,
} from 'electron';
import log from 'electron-log';
import { AppUpdater } from './appUpdater';

interface DarwinMenuItemConstructorOptions extends MenuItemConstructorOptions {
  selector?: string;
  submenu?: DarwinMenuItemConstructorOptions[] | Menu;
}

export default class MenuBuilder {
  mainWindow: BrowserWindow;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  buildMenu(): Menu {
    const template = this.getTemplate();
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
    return menu;
  }

  getTemplate(): MenuItemConstructorOptions[] {
    if (process.platform === 'darwin') {
      return this.getDarwinTemplate();
    }
    return this.getDefaultTemplate();
  }

  getDarwinTemplate(): MenuItemConstructorOptions[] {
    return [
      MenuBuilder.getAboutMenu('Easy Accounting'),
      this.getViewMenu(),
      MenuBuilder.getWindowMenu(),
      MenuBuilder.getHelpMenu(),
    ];
  }

  getDefaultTemplate(): MenuItemConstructorOptions[] {
    return [this.getFileMenu(), this.getViewMenu(), MenuBuilder.getHelpMenu()];
  }

  static getAboutMenu(appName: string): DarwinMenuItemConstructorOptions {
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

  static getWindowMenu(): DarwinMenuItemConstructorOptions {
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

  static getHelpMenu(): MenuItemConstructorOptions {
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

  getViewMenu(): DarwinMenuItemConstructorOptions {
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

  getFileMenu(): MenuItemConstructorOptions {
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
}
