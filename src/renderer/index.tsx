import { createRoot } from 'react-dom/client';
import Routes from './routes';
import './styles/App.global.css';
import 'tailwindcss/tailwind.css';
import jameelNastaleeqFontUrl from './fonts/JameelNooriNastaleeq.ttf';
import { setUrduPrintFontUrl } from './lib/invoicePrint/urduFont';

// electron-only: this entry is not used by the vite web app, so the 25MB
// Jameel file stays out of the browser graph. web sets a CDN url (or none).
setUrduPrintFontUrl(jameelNastaleeqFontUrl);

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);
root.render(<Routes />);
