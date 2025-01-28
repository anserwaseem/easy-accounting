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

export const BrowserWindow = jest.fn();
