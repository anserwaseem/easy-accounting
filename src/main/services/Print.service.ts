import { app, BrowserWindow, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { logErrors } from '../errorLogger';
import { raise } from '../utils/general';
import { getInvoicePdfPrintOptions } from './invoicePdfPrintOptions';

export type PrintResult =
  | { success: true; path?: string }
  | { success: false; cancelled?: boolean; error?: unknown };

/** render a BrowserWindow to a page-stamped PDF buffer */
const renderStampedPdf = async (win: BrowserWindow): Promise<Buffer> => {
  const data = await win.webContents.printToPDF(getInvoicePdfPrintOptions());
  return Buffer.from(data);
};

@logErrors
export class PrintService {
  private outputDir!: string;

  constructor() {
    this.setOutputDir();
  }

  get outputDirectory(): string {
    return this.outputDir;
  }

  private setOutputDir() {
    this.outputDir = path.join(app.getPath('userData'), 'invoices');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async printPDF(outputBaseName: string): Promise<PrintResult> {
    this.setOutputDir();
    try {
      const win = BrowserWindow.getFocusedWindow() ?? raise('No active window');

      const safeBase = outputBaseName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const outputPath = path.join(this.outputDir, `${safeBase}.pdf`);

      const data = await renderStampedPdf(win);
      fs.writeFileSync(outputPath, data);

      return { success: true, path: outputPath };
    } catch (error: unknown) {
      console.error('Failed to generate PDF:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : error,
      };
    }
  }

  /**
   * UI Print path: stamp pages via printToPDF, then open the PDF in the OS
   * viewer (Preview on macOS). Loading that PDF in a hidden BrowserWindow and
   * calling webContents.print() yields an empty 1-page job on Electron/macOS —
   * the PDF plugin content is not what gets printed.
   */
  // instance method for IPC parity with printPDF; no instance state needed
  // eslint-disable-next-line class-methods-use-this
  async printWithDialog(): Promise<PrintResult> {
    try {
      const win = BrowserWindow.getFocusedWindow() ?? raise('No active window');
      const data = await renderStampedPdf(win);

      // keep the file — Preview/reader needs it after openPath returns
      const tmpPath = path.join(
        app.getPath('temp'),
        `easy-accounting-print-${Date.now()}.pdf`,
      );
      fs.writeFileSync(tmpPath, data);

      const openError = await shell.openPath(tmpPath);
      if (openError) {
        return { success: false, error: openError };
      }

      return { success: true, path: tmpPath };
    } catch (error: unknown) {
      console.error('Failed to print invoice:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : error,
      };
    }
  }
}
