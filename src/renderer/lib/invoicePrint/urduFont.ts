import notoPreviewFontUrl from '../../fonts/NotoNastaliqUrdu-Regular.woff2';

/** small OFL face — first paint / web default. never block on this. */
export const URDU_PREVIEW_FONT_FAMILY = 'Noto Nastaliq Urdu';
/** print-quality face. electron registers a local url; web may omit it. */
export const URDU_PRINT_FONT_FAMILY = 'Jameel Noori Nastaleeq';

type UrduFontDisplay = 'swap' | 'block';

export interface SetUrduPrintFontUrlOptions {
  /**
   * electron only: skip Noto so the first Urdu paint cannot be a Noto→Jameel
   * swap. web must omit this — it still needs the 261KB preview face.
   */
  exclusive?: boolean;
}

/** first web print must not stall on a 25MB (or even 10MB woff2) download */
const PRINT_FONT_BUDGET_MS = 12_000;

let printFontUrl: string | null = null;
let printFontExclusive = false;
let previewLoad: Promise<void> | null = null;
let printLoad: Promise<void> | null = null;

/** electron entry sets a bundled url; web sets VITE_URDU_PRINT_FONT_URL or null */
export const setUrduPrintFontUrl = (
  url: string | null,
  options?: SetUrduPrintFontUrlOptions,
): void => {
  const next = url?.trim() ? url.trim() : null;
  const nextExclusive = next !== null && Boolean(options?.exclusive);
  if (next === printFontUrl && nextExclusive === printFontExclusive) {
    return;
  }
  printFontUrl = next;
  printFontExclusive = nextExclusive;
  printLoad = null;
};

export const getUrduPrintFontUrl = (): string | null => printFontUrl;

export const isUrduPrintFontExclusive = (): boolean => printFontExclusive;

export const getUrduPreviewFontUrl = (): string => notoPreviewFontUrl;

/**
 * tailwind class for Urdu chrome. exclusive electron is Jameel only;
 * web keeps Noto in the stack so preview never waits on a multi-MB file.
 */
export const getUrduFontClass = (): string =>
  printFontExclusive
    ? "font-['Jameel_Noori_Nastaleeq',serif]"
    : "font-['Jameel_Noori_Nastaleeq','Noto_Nastaliq_Urdu',serif]";

const fontSourceFormat = (url: string): 'woff2' | 'truetype' => {
  const path = url.split('?')[0].toLowerCase();
  return path.endsWith('.woff2') ? 'woff2' : 'truetype';
};

const fontFaceCss = (
  family: string,
  url: string,
  display: UrduFontDisplay,
): string => `@font-face {
            font-family: '${family}';
            src: url(${url}) format('${fontSourceFormat(url)}');
            font-weight: 400 700;
            font-display: ${display};
          }`;

/** @font-face rules for the print document (printToPDF reads these) */
export const getUrduFontFaceCss = (): string => {
  if (printFontExclusive && printFontUrl) {
    return fontFaceCss(URDU_PRINT_FONT_FAMILY, printFontUrl, 'block');
  }
  const faces = [
    fontFaceCss(URDU_PREVIEW_FONT_FAMILY, notoPreviewFontUrl, 'swap'),
  ];
  if (printFontUrl) {
    faces.push(fontFaceCss(URDU_PRINT_FONT_FAMILY, printFontUrl, 'swap'));
  }
  return faces.join('\n');
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const loadFace = async (
  family: string,
  url: string,
  display: UrduFontDisplay,
): Promise<void> => {
  if (typeof document === 'undefined' || !document.fonts) {
    return;
  }
  if (typeof FontFace === 'undefined') {
    await document.fonts.load(`16px '${family}'`);
    return;
  }
  const face = new FontFace(family, `url(${url})`, {
    display,
    weight: '400 700',
  });
  document.fonts.add(face);
  await face.load();
};

const ensurePreviewFont = (): Promise<void> => {
  if (!previewLoad) {
    previewLoad = loadFace(
      URDU_PREVIEW_FONT_FAMILY,
      notoPreviewFontUrl,
      'swap',
    );
  }
  return previewLoad;
};

const prefetchPrintFont = (): void => {
  if (!printFontUrl || printLoad) {
    return;
  }
  printLoad = loadFace(
    URDU_PRINT_FONT_FAMILY,
    printFontUrl,
    printFontExclusive ? 'block' : 'swap',
  );
};

/**
 * preview: Noto (fast) + kick Jameel in the background, unless exclusive.
 * print: wait for Jameel up to PRINT_FONT_BUDGET_MS, then proceed with Noto.
 * exclusive (electron): never fetch Noto; wait for Jameel on preview and print.
 */
export const ensureUrduInvoiceFonts = async (
  mode: 'preview' | 'print',
): Promise<void> => {
  if (typeof document === 'undefined' || !document.fonts) {
    return;
  }

  prefetchPrintFont();

  try {
    await document.fonts.ready;

    if (printFontExclusive) {
      if (printLoad) {
        await Promise.race([printLoad, sleep(PRINT_FONT_BUDGET_MS)]);
      }
      return;
    }

    await ensurePreviewFont();
    if (mode === 'preview' || !printLoad) {
      return;
    }
    await Promise.race([printLoad, sleep(PRINT_FONT_BUDGET_MS)]);
  } catch {
    // caller still prints; glyphs fall back to Noto / serif
  }
};

/** jest helper — module-level load promises must not leak across tests */
export const resetUrduInvoiceFontsForTests = (): void => {
  printFontUrl = null;
  printFontExclusive = false;
  previewLoad = null;
  printLoad = null;
};
