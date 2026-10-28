import { createRoot } from 'react-dom/client';
import Routes from './routes';
import './styles/App.global.css';
import 'tailwindcss/tailwind.css';
import jameelNastaleeqFontUrl from './fonts/JameelNooriNastaleeq.woff2';
import notoNastaliqFontUrl from './fonts/NotoNastaliqUrdu-Regular.woff2';
import {
  ensureUrduInvoiceFonts,
  setUrduPrintFontUrl,
} from './lib/invoicePrint/urduFont';

/**
 * local A/B only — flip this, save, let webpack rebuild, hard-reload the print view.
 * do not swap only the url into setUrduPrintFontUrl: exclusive used to keep the
 * Jameel family name, so Noto got Jameel's size/metrics. ship as 'jameel'.
 */
const URDU_ELECTRON_FACE = 'jameel' as 'jameel' | 'noto';

setUrduPrintFontUrl(
  URDU_ELECTRON_FACE === 'noto' ? notoNastaliqFontUrl : jameelNastaleeqFontUrl,
  { exclusive: true },
);
ensureUrduInvoiceFonts('print').catch(() => {});

// suppress benign ResizeObserver loop limit notifications that webpack dev server
// treats as fatal runtime crashes with a full-screen overlay
if (typeof window !== 'undefined') {
  window.addEventListener(
    'error',
    (event) => {
      const msg = event?.message;
      if (
        typeof msg === 'string' &&
        (msg.includes('ResizeObserver loop limit exceeded') ||
          msg.includes(
            'ResizeObserver loop completed with undelivered notifications',
          ))
      ) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    },
    true,
  );
}

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);
root.render(<Routes />);
