/**
 * print the Bills Aging report in an isolated iframe so the application's
 * chrome (sidebar, mobile top bar: back button, title, hamburger, search)
 * never appears on the printed page, regardless of Tailwind print utilities.
 */
import { printStyles } from '../components/printStyles';

export const printBillsAgingIframe = (): void => {
  // The on-screen print region rendered by BillsAgingPrintTable. It is
  // hidden on screen (hidden print:block) but carries the full flat table.
  const printRegion = Array.from(
    document.querySelectorAll<HTMLElement>('div.hidden.print\\:block'),
  ).find((node) => node.querySelector('table.bills-aging-print-table'));
  if (!printRegion) return;

  // Preserve the report heading (head + date) that is printed above the table.
  const printHeader = document.querySelector<HTMLElement>('.print-header');

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: 'none',
    visibility: 'hidden',
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write('<!DOCTYPE html><html><head></head><body></body></html>');
  doc.close();

  const { head } = doc;
  // copy every stylesheet so Tailwind utilities and component CSS survive
  document
    .querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
    .forEach((link) => {
      const clone = document.createElement('link');
      clone.rel = 'stylesheet';
      clone.href = link.href;
      head.appendChild(clone);
    });
  document.querySelectorAll<HTMLStyleElement>('style').forEach((style) => {
    const clone = document.createElement('style');
    clone.textContent = style.textContent;
    head.appendChild(clone);
  });
  // guarantee the shared print rules and the report title are present
  const extra = document.createElement('style');
  extra.textContent = printStyles;
  head.appendChild(extra);

  const title = document.createElement('title');
  title.textContent = 'Bills Aging';
  head.appendChild(title);

  // copy the heading and table markup, without the hidden/print wrapper classes
  const bodyWrap = document.createElement('div');
  bodyWrap.innerHTML = `${printHeader ? printHeader.innerHTML : ''}${
    printRegion.innerHTML
  }`;
  doc.body.appendChild(bodyWrap);

  let cleaned = false;
  const timers: { fallback?: number } = {};
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timers.fallback !== undefined) window.clearTimeout(timers.fallback);
    win.removeEventListener('afterprint', cleanup);
    iframe.remove();
  };
  timers.fallback = window.setTimeout(cleanup, 120_000);
  win.addEventListener('afterprint', cleanup);

  // wait for the cloned stylesheets to load before opening the print dialog
  const links = Array.from(
    doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  );
  const done = () => {
    window.setTimeout(() => {
      win.focus();
      win.print();
    }, 0);
  };
  if (links.length === 0) {
    done();
    return;
  }
  let remaining = links.length;
  const finishOne = () => {
    remaining -= 1;
    if (remaining <= 0) done();
  };
  links.forEach((link) => {
    link.addEventListener('load', finishOne, { once: true });
    link.addEventListener('error', finishOne, { once: true });
  });
  window.setTimeout(done, 1500);
};
