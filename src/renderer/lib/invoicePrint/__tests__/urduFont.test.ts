import {
  ensureUrduInvoiceFonts,
  getUrduFontFaceCss,
  getUrduPreviewFontUrl,
  getUrduPrintFontUrl,
  resetUrduInvoiceFontsForTests,
  setUrduPrintFontUrl,
  URDU_PREVIEW_FONT_FAMILY,
  URDU_PRINT_FONT_FAMILY,
} from '../urduFont';
import { waitForInvoicePrintFonts } from '../locale';

describe('urdu invoice fonts', () => {
  const loadedFamilies: string[] = [];

  beforeEach(() => {
    resetUrduInvoiceFontsForTests();
    loadedFamilies.length = 0;

    class FontFaceMock {
      family: string;

      constructor(family: string) {
        this.family = family;
      }

      load() {
        loadedFamilies.push(this.family);
        return Promise.resolve(this);
      }
    }

    Object.defineProperty(global, 'FontFace', {
      configurable: true,
      writable: true,
      value: FontFaceMock,
    });

    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        add: jest.fn(),
        load: jest.fn(async () => []),
        ready: Promise.resolve(),
      },
    });
  });

  it('emits Noto preview face and omits Jameel until a print url is set', () => {
    const css = getUrduFontFaceCss();
    expect(css).toContain(URDU_PREVIEW_FONT_FAMILY);
    expect(css).toContain(getUrduPreviewFontUrl());
    expect(css).not.toContain(URDU_PRINT_FONT_FAMILY);
    expect(getUrduPrintFontUrl()).toBeNull();
  });

  it('adds a Jameel face only after the platform registers a url', () => {
    setUrduPrintFontUrl('https://cdn.example/JameelNooriNastaleeq.ttf');
    const css = getUrduFontFaceCss();
    expect(css).toContain(URDU_PRINT_FONT_FAMILY);
    expect(css).toContain('https://cdn.example/JameelNooriNastaleeq.ttf');
    expect(css).toContain("format('truetype')");
    expect(css).toContain('font-display: swap');
  });

  it('detects woff2 on hashed or query-string print urls', () => {
    setUrduPrintFontUrl('https://cdn.example/Jameel.abc123.woff2?v=2');
    expect(getUrduFontFaceCss()).toContain("format('woff2')");
  });

  it('treats blank print urls as unset', () => {
    setUrduPrintFontUrl('   ');
    expect(getUrduPrintFontUrl()).toBeNull();
    expect(getUrduFontFaceCss()).not.toContain(URDU_PRINT_FONT_FAMILY);
  });

  it('preview loads Noto and prefetches Jameel without blocking on it', async () => {
    setUrduPrintFontUrl('/jameel.woff2');
    await ensureUrduInvoiceFonts('preview');
    expect(loadedFamilies).toEqual([
      URDU_PRINT_FONT_FAMILY,
      URDU_PREVIEW_FONT_FAMILY,
    ]);
  });

  it('english print does not fetch Nastaliq faces', async () => {
    setUrduPrintFontUrl('/jameel.woff2');
    await waitForInvoicePrintFonts('en');
    expect(loadedFamilies).toEqual([]);
  });

  it('urdu print waits for the registered print face', async () => {
    setUrduPrintFontUrl('/jameel.woff2');
    await waitForInvoicePrintFonts('ur');
    expect(loadedFamilies).toContain(URDU_PREVIEW_FONT_FAMILY);
    expect(loadedFamilies).toContain(URDU_PRINT_FONT_FAMILY);
  });
});
