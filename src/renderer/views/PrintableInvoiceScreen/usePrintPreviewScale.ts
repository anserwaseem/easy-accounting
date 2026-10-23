import { useCallback, useLayoutEffect, useState } from 'react';
import { useIsMobile } from '@/renderer/hooks/useIsMobile';
import { A4_PREVIEW_WIDTH_PX } from '@/renderer/lib/invoicePrint/mobilePrint';

interface PrintPreviewScale {
  /** the box that holds the scaled page */
  wrapperRef: (node: HTMLDivElement | null) => void;
  /** the sheet itself, measured at its natural A4 width */
  sheetRef: (node: HTMLDivElement | null) => void;
  /** the wrapper is sized to the scaled page so the page does not leave a gap */
  wrapperStyle: React.CSSProperties;
  /** the sheet is laid out at A4 width and scaled down to fit the screen */
  sheetStyle: React.CSSProperties;
}

/**
 * The on-screen preview is a phone showing a sheet of paper. Laid out at the
 * screen's width it is not a page at all — the columns crush and the
 * proportions lie about what the print will look like. So on a phone the
 * sheet is laid out at A4 width (794px at 96dpi) and scaled down to fit,
 * exactly like a PDF viewer does. The print stylesheet takes the scale back
 * off, so the paper is still a full-width A4 page.
 */
export const usePrintPreviewScale = (
  rtl: boolean = false,
): PrintPreviewScale => {
  const isMobile = useIsMobile();
  // callback refs, not object refs: the sheet is not in the DOM on the
  // first render (the screen shows a "Loading…" placeholder until the
  // invoice arrives), and an object ref gives the effect nothing to react
  // to — it would measure a null element once and never measure again.
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(() => {
    if (typeof window === 'undefined') return 1;
    const available = window.innerWidth || A4_PREVIEW_WIDTH_PX;
    return Math.min(1, Math.max(0.1, available / A4_PREVIEW_WIDTH_PX));
  });
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);

  const wrapperRef = useCallback((node: HTMLDivElement | null) => {
    setWrapper(node);
  }, []);
  const sheetRef = useCallback((node: HTMLDivElement | null) => {
    setSheet(node);
  }, []);

  useLayoutEffect(() => {
    if (!isMobile) {
      setScale(1);
      setSheetHeight(null);
      return undefined;
    }
    if (!wrapper || !sheet) {
      return undefined;
    }

    const measure = () => {
      const available = wrapper.clientWidth;
      if (available <= 0) return;
      const next = Math.min(1, available / A4_PREVIEW_WIDTH_PX);
      setScale((current) =>
        Math.abs(current - next) < 0.001 ? current : next,
      );
      const height = sheet.offsetHeight;
      setSheetHeight((current) =>
        current === null || Math.abs(current - height) > 0.5 ? height : current,
      );
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    observer.observe(sheet);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isMobile, wrapper, sheet]);

  if (!isMobile) {
    return {
      wrapperRef,
      sheetRef,
      wrapperStyle: {},
      sheetStyle: {},
    };
  }

  return {
    wrapperRef,
    sheetRef,
    wrapperStyle: {
      // the wrapper's own width is left alone on purpose: it is the block
      // box the page lays out in, so its clientWidth IS the space the page
      // has to fit into. Setting a width here would feed the measurement
      // back into itself and the scale would never come down.
      // until the sheet is measured, leave the box to its content rather than
      // collapsing to zero, which would hide the invoice behind the toolbar.
      height: sheetHeight == null ? undefined : sheetHeight * scale,
      // keep the scaled sheet anchored to the side the content starts on, so
      // an RTL/Urdu invoice is not clipped out of view in portrait mode.
      display: 'flex',
      justifyContent: rtl ? 'flex-end' : 'flex-start',
      direction: rtl ? 'rtl' : 'ltr',
      // the sheet's layout box is a full A4 wide, so once measured the
      // wrapper clips it to the scaled page. before measurement, leave it
      // visible so the invoice never disappears while the size is computed.
      overflow: sheetHeight == null ? 'visible' : 'hidden',
    },
    sheetStyle: {
      width: A4_PREVIEW_WIDTH_PX,
      transform: `scale(${scale})`,
      transformOrigin: rtl ? 'top right' : 'top left',
    },
  };
};

export default usePrintPreviewScale;
