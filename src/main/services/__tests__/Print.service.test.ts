import fs from 'fs';
import path from 'path';
import { app, BrowserWindow } from 'electron';
import { PrintService } from '../Print.service';
import { getInvoicePdfPrintOptions } from '../invoicePdfPrintOptions';

jest.mock('electron-log', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  verbose: jest.fn(),
  debug: jest.fn(),
  silly: jest.fn(),
  transports: {
    file: { getFile: jest.fn() },
    console: { level: 'debug' },
  },
}));

type PrintWindowMock = {
  loadURL: jest.Mock;
  close: jest.Mock;
  isDestroyed: jest.Mock;
  webContents: { print: jest.Mock };
};

type BrowserWindowMock = jest.Mock & {
  getFocusedWindow: jest.Mock;
  getPrintWindow: () => PrintWindowMock;
};

jest.mock('electron', () => {
  const printWin: PrintWindowMock = {
    loadURL: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
    isDestroyed: jest.fn(() => false),
    webContents: {
      print: jest.fn(
        (
          _opts: unknown,
          cb: (success: boolean, failureReason?: string) => void,
        ) => {
          cb(true);
        },
      ),
    },
  };

  const BrowserWindowMock = jest.fn(() => printWin) as BrowserWindowMock;
  BrowserWindowMock.getFocusedWindow = jest.fn();
  BrowserWindowMock.getPrintWindow = () => printWin;

  return {
    app: {
      getPath: jest.fn((name: string) =>
        name === 'temp'
          ? '/tmp/easy-accounting-test-temp'
          : '/tmp/easy-accounting-test-userData',
      ),
    },
    BrowserWindow: BrowserWindowMock,
  };
});

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

const mockBrowserWindow = BrowserWindow as unknown as BrowserWindowMock;
const printWin = mockBrowserWindow.getPrintWindow();

const focusedWindow = {
  webContents: {
    printToPDF: jest.fn(),
  },
};

describe('PrintService.printPDF', () => {
  let printService: PrintService;

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    mockBrowserWindow.getFocusedWindow.mockReturnValue(focusedWindow);
    focusedWindow.webContents.printToPDF.mockResolvedValue(
      Buffer.from('%PDF-page-stamp-test'),
    );
    // clearAllMocks strips getPath impl — restore
    (app.getPath as jest.Mock).mockImplementation((name: string) =>
      name === 'temp'
        ? '/tmp/easy-accounting-test-temp'
        : '/tmp/easy-accounting-test-userData',
    );
    printService = new PrintService();
  });

  it('passes page-number print options to printToPDF', async () => {
    const result = await printService.printPDF('sale-12');

    expect(focusedWindow.webContents.printToPDF).toHaveBeenCalledTimes(1);
    expect(focusedWindow.webContents.printToPDF).toHaveBeenCalledWith(
      getInvoicePdfPrintOptions(),
    );
    expect(result).toEqual({
      success: true,
      path: path.join(
        '/tmp/easy-accounting-test-userData',
        'invoices',
        'sale-12.pdf',
      ),
    });
  });

  it('writes the PDF bytes to the invoices output folder', async () => {
    await printService.printPDF('purchase-3');

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(
        '/tmp/easy-accounting-test-userData',
        'invoices',
        'purchase-3.pdf',
      ),
      expect.any(Buffer),
    );
  });

  it('sanitizes unsafe characters in the output base name', async () => {
    await printService.printPDF('inv/12:foo bar');

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(
        '/tmp/easy-accounting-test-userData',
        'invoices',
        'inv_12_foo_bar.pdf',
      ),
      expect.any(Buffer),
    );
  });

  it('creates the invoices directory when missing', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    await printService.printPDF('12');

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join('/tmp/easy-accounting-test-userData', 'invoices'),
      { recursive: true },
    );
    expect(app.getPath).toHaveBeenCalledWith('userData');
  });

  it('returns failure when no focused window is available', async () => {
    mockBrowserWindow.getFocusedWindow.mockReturnValue(null);

    const result = await printService.printPDF('12');

    expect(result.success).toBe(false);
    expect(result).toHaveProperty('error');
    expect(focusedWindow.webContents.printToPDF).not.toHaveBeenCalled();
  });

  it('returns failure when printToPDF rejects', async () => {
    focusedWindow.webContents.printToPDF.mockRejectedValue(
      new Error('pdf boom'),
    );

    const result = await printService.printPDF('12');

    expect(result).toEqual({
      success: false,
      error: 'pdf boom',
    });
  });
});

describe('PrintService.printWithDialog', () => {
  let printService: PrintService;

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    mockBrowserWindow.getFocusedWindow.mockReturnValue(focusedWindow);
    focusedWindow.webContents.printToPDF.mockResolvedValue(
      Buffer.from('%PDF-print-dialog-test'),
    );
    printWin.loadURL.mockResolvedValue(undefined);
    printWin.isDestroyed.mockReturnValue(false);
    printWin.webContents.print.mockImplementation(
      (
        _opts: unknown,
        cb: (success: boolean, failureReason?: string) => void,
      ) => {
        cb(true);
      },
    );
    (app.getPath as jest.Mock).mockImplementation((name: string) =>
      name === 'temp'
        ? '/tmp/easy-accounting-test-temp'
        : '/tmp/easy-accounting-test-userData',
    );
    printService = new PrintService();
  });

  it('stamps PDF then opens the system print dialog', async () => {
    const result = await printService.printWithDialog();

    expect(focusedWindow.webContents.printToPDF).toHaveBeenCalledWith(
      getInvoicePdfPrintOptions(),
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/tmp\/easy-accounting-test-temp\/easy-accounting-print-\d+\.pdf$/,
      ),
      expect.any(Buffer),
    );
    expect(mockBrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        show: false,
        webPreferences: expect.objectContaining({ plugins: true }),
      }),
    );
    expect(printWin.loadURL).toHaveBeenCalledWith(
      expect.stringMatching(/^file:\/\/\/tmp\/easy-accounting-test-temp\//),
    );
    expect(printWin.webContents.print).toHaveBeenCalledWith(
      { silent: false, printBackground: true },
      expect.any(Function),
    );
    expect(printWin.close).toHaveBeenCalled();
    expect(fs.unlinkSync).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('treats print dialog cancel as cancelled, not hard failure', async () => {
    printWin.webContents.print.mockImplementation(
      (
        _opts: unknown,
        cb: (success: boolean, failureReason?: string) => void,
      ) => {
        cb(false, 'cancelled');
      },
    );

    const result = await printService.printWithDialog();

    expect(result).toEqual({ success: false, cancelled: true });
    expect(printWin.close).toHaveBeenCalled();
    expect(fs.unlinkSync).toHaveBeenCalled();
  });

  it('returns failure when printToPDF rejects', async () => {
    focusedWindow.webContents.printToPDF.mockRejectedValue(
      new Error('stamp boom'),
    );

    const result = await printService.printWithDialog();

    expect(result).toEqual({
      success: false,
      error: 'stamp boom',
    });
    expect(printWin.webContents.print).not.toHaveBeenCalled();
  });

  it('returns failure when no focused window is available', async () => {
    mockBrowserWindow.getFocusedWindow.mockReturnValue(null);

    const result = await printService.printWithDialog();

    expect(result.success).toBe(false);
    expect(result).toHaveProperty('error');
    expect(focusedWindow.webContents.printToPDF).not.toHaveBeenCalled();
  });
});
