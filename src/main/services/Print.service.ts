import { app, BrowserWindow } from 'electron';
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
   * UI Print button path: stamp pages via printToPDF, then open the system
   * print dialog on that PDF so stamps match batch save (window.print cannot).
   */
  // instance method for IPC parity with printPDF; no instance state needed
  // eslint-disable-next-line class-methods-use-this
  async printWithDialog(): Promise<PrintResult> {
    let tmpPath: string | null = null;
    let printWin: BrowserWindow | null = null;

    try {
      const win = BrowserWindow.getFocusedWindow() ?? raise('No active window');
      const data = await renderStampedPdf(win);

      tmpPath = path.join(
        app.getPath('temp'),
        `easy-accounting-print-${Date.now()}.pdf`,
      );
      fs.writeFileSync(tmpPath, data);

      printWin = new BrowserWindow({
        show: false,
        webPreferences: {
          plugins: true,
          contextIsolation: true,
        },
      });

      await printWin.loadURL(`file://${tmpPath}`);

      const dialogWin = printWin;
      const printOutcome = await new Promise<{
        ok: boolean;
        failureReason?: string;
      }>((resolve) => {
        dialogWin.webContents.print(
          { silent: false, printBackground: true },
          (success, failureReason) => {
            resolve({ ok: success, failureReason });
          },
        );
      });

      if (!printOutcome.ok) {
        const reason = (printOutcome.failureReason ?? '').toLowerCase();
        const cancelled =
          reason.includes('cancel') || reason === '' || reason.includes('user');
        return cancelled
          ? { success: false, cancelled: true }
          : {
              success: false,
              error: printOutcome.failureReason ?? 'Print failed',
            };
      }

      return { success: true };
    } catch (error: unknown) {
      console.error('Failed to print invoice:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : error,
      };
    } finally {
      if (printWin && !printWin.isDestroyed()) {
        printWin.close();
      }
      if (tmpPath) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // temp cleanup is best-effort
        }
      }
    }
  }
}
