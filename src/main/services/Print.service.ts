import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { logErrors } from '../errorLogger';

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

  async printPDF(invoiceNumber: number) {
    this.setOutputDir();
    try {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) throw new Error('No active window');

      const outputPath = path.join(this.outputDir, `${invoiceNumber}.pdf`);

      const data = await win.webContents.printToPDF({
        printBackground: true,
        margins: {
          marginType: 'none',
        },
      });

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
}
