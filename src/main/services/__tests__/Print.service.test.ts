import fs from 'fs';
import path from 'path';
import { app, BrowserWindow, shell } from 'electron';
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

type BrowserWindowMock = jest.Mock & {
  getFocusedWindow: jest.Mock;
};

jest.mock('electron', () => {
  const BrowserWindowMock = jest.fn() as BrowserWindowMock;
  BrowserWindowMock.getFocusedWindow = jest.fn();

  return {
    app: {
      getPath: jest.fn((name: string) =>
        name === 'temp'
          ? '/tmp/easy-accounting-test-temp'
          : '/tmp/easy-accounting-test-userData',
      ),
    },
    BrowserWindow: BrowserWindowMock,
    shell: {
      openPath: jest.fn().mockResolvedValue(''),
    },
  };
});

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

const mockBrowserWindow = BrowserWindow as unknown as BrowserWindowMock;

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
    (shell.openPath as jest.Mock).mockResolvedValue('');
    (app.getPath as jest.Mock).mockImplementation((name: string) =>
      name === 'temp'
        ? '/tmp/easy-accounting-test-temp'
        : '/tmp/easy-accounting-test-userData',
    );
    printService = new PrintService();
  });

  it('stamps PDF then opens it in the OS viewer', async () => {
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
    expect(shell.openPath).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/tmp\/easy-accounting-test-temp\/easy-accounting-print-\d+\.pdf$/,
      ),
    );
    // do not delete — Preview needs the file
    expect(fs.unlinkSync).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      path: expect.stringMatching(
        /^\/tmp\/easy-accounting-test-temp\/easy-accounting-print-\d+\.pdf$/,
      ),
    });
  });

  it('returns failure when the OS cannot open the PDF', async () => {
    (shell.openPath as jest.Mock).mockResolvedValue('Failed to open path');

    const result = await printService.printWithDialog();

    expect(result).toEqual({
      success: false,
      error: 'Failed to open path',
    });
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
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it('returns failure when no focused window is available', async () => {
    mockBrowserWindow.getFocusedWindow.mockReturnValue(null);

    const result = await printService.printWithDialog();

    expect(result.success).toBe(false);
    expect(result).toHaveProperty('error');
    expect(focusedWindow.webContents.printToPDF).not.toHaveBeenCalled();
  });
});
