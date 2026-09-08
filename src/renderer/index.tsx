import { createRoot } from 'react-dom/client';
import Routes from './routes';
import './styles/App.global.css';
import 'tailwindcss/tailwind.css';
import jameelNastaleeqFontUrl from './fonts/JameelNooriNastaleeq.woff2';
import {
  ensureUrduInvoiceFonts,
  setUrduPrintFontUrl,
} from './lib/invoicePrint/urduFont';

// electron-only: this entry is not used by the vite web app, so Jameel
// stays out of the browser graph. web serves the same woff2 from R2.
// exclusive: do not put Noto on the stack (that was the Noto→Jameel flash).
setUrduPrintFontUrl(jameelNastaleeqFontUrl, { exclusive: true });
// start the 9.4MB face at boot so the first Urdu click is already Jameel
ensureUrduInvoiceFonts('print').catch(() => {});

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);
root.render(<Routes />);
