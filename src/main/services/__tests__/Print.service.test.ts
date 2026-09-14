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

const printToPDF = jest.fn();
const focusedWindow = {
  webContents: {
    printToPDF,
  },
};

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/easy-accounting-test-userData'),
  },
  BrowserWindow: {
    getFocusedWindow: jest.fn(),
  },
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

describe('PrintService.printPDF', () => {
  let printService: PrintService;

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (BrowserWindow.getFocusedWindow as jest.Mock).mockReturnValue(
      focusedWindow,
    );
    printToPDF.mockResolvedValue(Buffer.from('%PDF-page-stamp-test'));
    printService = new PrintService();
  });

  it('passes page-number print options to printToPDF', async () => {
    const result = await printService.printPDF('sale-12');

    expect(printToPDF).toHaveBeenCalledTimes(1);
    expect(printToPDF).toHaveBeenCalledWith(getInvoicePdfPrintOptions());
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
      expect.any(Uint8Array),
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
      expect.any(Uint8Array),
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
    (BrowserWindow.getFocusedWindow as jest.Mock).mockReturnValue(null);

    const result = await printService.printPDF('12');

    expect(result.success).toBe(false);
    expect(result).toHaveProperty('error');
    expect(printToPDF).not.toHaveBeenCalled();
  });

  it('returns failure when printToPDF rejects', async () => {
    printToPDF.mockRejectedValue(new Error('pdf boom'));

    const result = await printService.printPDF('12');

    expect(result).toEqual({
      success: false,
      error: 'pdf boom',
    });
  });
});
