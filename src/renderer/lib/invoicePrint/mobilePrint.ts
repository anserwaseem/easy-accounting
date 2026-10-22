/**
 * What a phone browser can actually do with a print request.
 *
 * Printing an invoice on a phone is not one feature, it is three different
 * browser behaviours, and the app has to say the right thing for each:
 *
 *  - Chrome on Android opens the system print screen from `window.print()`.
 *    That screen carries a "Save as PDF" destination, so on Android the
 *    print screen IS the PDF export — no separate file is needed.
 *  - Chrome on iOS is a WKWebView wrapper: `window.print()` is accepted and
 *    ignored, and only the browser's own share sheet can print. The path is
 *    Share -> Print -> (preview) -> Share -> Save to Files.
 *  - Safari on iOS does implement `window.print()` (iOS 13+), so the same
 *    button works there.
 *  - An installed PWA (standalone display mode) on Android still reaches the
 *    print screen, but some WebAPK builds drop it silently. The app notices
 *    the missing `beforeprint` event and falls back to instructions.
 */

/** A4 at 96dpi — the width the on-screen preview is laid out at. */
export const A4_PREVIEW_WIDTH_PX = 794;

export interface PrintEnvironment {
  /** iPhone or iPad (including iPadOS, which reports itself as a Mac). */
  isIos: boolean;
  /** Chrome on iOS: a WKWebView wrapper, so `window.print()` does nothing. */
  isIosChrome: boolean;
  isAndroid: boolean;
  /** launched from the home screen rather than a browser tab. */
  isStandalone: boolean;
  /** the browser exposes `window.print()` at all. */
  hasPrintApi: boolean;
}

const readUserAgent = (): string => {
  if (typeof navigator === 'undefined') return '';
  return navigator.userAgent ?? '';
};

export const getPrintEnvironment = (): PrintEnvironment => {
  const ua = readUserAgent();
  // iPadOS 13+ sends a desktop Safari UA with touch points; that is an iPad.
  const isIpadOs =
    ua.includes('Mac') &&
    typeof navigator !== 'undefined' &&
    navigator.maxTouchPoints > 1;
  const isIos = /iPad|iPhone|iPod/.test(ua) || isIpadOs;
  const isStandalone =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;

  return {
    isIos,
    // CriOS is Chrome on iOS; Safari on iOS has no such token.
    isIosChrome: isIos && /CriOS/.test(ua),
    isAndroid: /Android/.test(ua),
    isStandalone,
    hasPrintApi:
      typeof window !== 'undefined' && typeof window.print === 'function',
  };
};

export interface PrintHelp {
  title: string;
  intro: string;
  steps: string[];
}

/**
 * The steps for the platform at hand, in the order the user has to tap
 * them. Used by the help sheet the app opens when the browser refuses to
 * print the page.
 */
export const getPrintHelp = (environment: PrintEnvironment): PrintHelp => {
  if (environment.isIosChrome) {
    return {
      title: 'Print from the browser menu',
      intro:
        'Chrome on iPhone cannot print a page from inside the app. The browser can still do it:',
      steps: [
        'Tap the Share button (the square with an arrow) in Chrome.',
        'Scroll down the share sheet and tap Print.',
        'In the print preview, tap Share again and choose Save to Files.',
      ],
    };
  }

  if (environment.isIos) {
    return {
      title: 'Print from the share sheet',
      intro: 'Save this invoice as a PDF from the iOS share sheet:',
      steps: [
        'Tap the Share button (the square with an arrow).',
        'Scroll down the share sheet and tap Print.',
        'In the print preview, tap Share again and choose Save to Files.',
      ],
    };
  }

  if (environment.isAndroid) {
    return {
      title: 'Save this invoice as a PDF',
      intro: 'The print screen on Android can save the invoice as a file:',
      steps: [
        'Tap Print.',
        'Choose Save as PDF as the destination, or pick a printer.',
        'Save it, then share the file from your Files app.',
      ],
    };
  }

  return {
    title: 'The print screen did not open',
    intro:
      'This browser did not open its print screen. You can still print the page:',
    steps: [
      'Open the browser print command (Ctrl+P on Windows and Linux, Cmd+P on a Mac).',
      'Choose a printer or Save as PDF as the destination.',
    ],
  };
};

/**
 * The one-line reminder under the print button. Null on the desktop, where
 * the print dialog explains itself.
 */
export const getPrintHint = (environment: PrintEnvironment): string | null => {
  if (environment.isIosChrome) {
    return 'Chrome on iPhone cannot print from this page. Tap the ⋮ button for the steps that do work.';
  }
  if (environment.isIos) {
    return 'The print screen opens here. Choose Save to Files to keep a PDF.';
  }
  if (environment.isAndroid) {
    return 'The print screen opens here. Choose Save as PDF to keep a PDF.';
  }
  return null;
};
