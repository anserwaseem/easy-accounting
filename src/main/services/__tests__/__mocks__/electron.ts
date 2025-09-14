export const Notification = jest.fn().mockImplementation(() => ({
  show: jest.fn(),
}));

export const app = {
  getPath: jest.fn(),
  isPackaged: false,
};

export const dialog = {
  showMessageBox: jest.fn(),
};

export const shell = {
  showItemInFolder: jest.fn(),
};

const BrowserWindowMock = jest.fn().mockImplementation(() => ({
  isDestroyed: jest.fn(() => false),
  webContents: {
    send: jest.fn(),
  },
}));

(BrowserWindowMock as any).getAllWindows = jest.fn(() => [
  {
    isDestroyed: jest.fn(() => false),
    webContents: {
      send: jest.fn(),
    },
  },
]);

export const BrowserWindow = BrowserWindowMock;
