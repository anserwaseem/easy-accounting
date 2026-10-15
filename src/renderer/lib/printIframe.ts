/**
 * prints HTML in a dedicated, hidden iframe and cleanly destroys the iframe
 * and its browsing context upon completion or fallback timeout.
 *
 * Ensures only one print iframe is active at a time to prevent detached
 * iframes from piling up if a user clicks print repeatedly.
 */

interface ActivePrintSession {
  cleanup: () => void;
}

let activeSession: ActivePrintSession | null = null;

export const printHtmlInHiddenIframe = (
  html: string,
  options?: { fallbackTimeoutMs?: number },
): void => {
  // if a previous print session is still pending, clean it up immediately
  if (activeSession) {
    activeSession.cleanup();
  }

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

  try {
    doc.open();
    doc.write(html);
    doc.close();
  } catch {
    iframe.remove();
    return;
  }

  let cleaned = false;
  let printTimer: number | undefined;
  let fallbackTimer: number | undefined;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;

    if (printTimer !== undefined) {
      window.clearTimeout(printTimer);
      printTimer = undefined;
    }
    if (fallbackTimer !== undefined) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = undefined;
    }

    try {
      win.removeEventListener('afterprint', cleanup);
      win.removeEventListener('error', cleanup);
    } catch {
      // ignore
    }

    if (activeSession?.cleanup === cleanup) {
      activeSession = null;
    }

    // unload document content and redirect to blank to release DOM memory immediately
    try {
      if (doc.body) {
        doc.body.innerHTML = '';
      }
    } catch {
      // ignore
    }

    try {
      iframe.src = 'about:blank';
    } catch {
      // ignore
    }

    iframe.remove();
  };

  activeSession = { cleanup };

  const timeoutMs = options?.fallbackTimeoutMs ?? 120_000;
  fallbackTimer = window.setTimeout(cleanup, timeoutMs);

  try {
    win.addEventListener('afterprint', cleanup);
    win.addEventListener('error', cleanup);
  } catch {
    // ignore
  }

  // yield so calling UI can repaint before the print dialog opens
  printTimer = window.setTimeout(() => {
    if (cleaned) return;
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
    }
  }, 0);
};
