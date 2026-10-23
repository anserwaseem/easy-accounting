/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { A4_PREVIEW_WIDTH_PX } from '@/renderer/lib/invoicePrint/mobilePrint';
import { usePrintPreviewScale } from '../usePrintPreviewScale';

/** the width the page has to fit into on a 390px phone */
const AVAILABLE_WIDTH = 366;
/** the height of the sheet, measured at its natural A4 width */
const SHEET_HEIGHT = 1000;

describe('usePrintPreviewScale', () => {
  beforeEach(() => {
    // the phone layout
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      onchange: null,
      dispatchEvent: jest.fn(),
    }));
    // jsdom has no layout: give the wrapper a width and the sheet a height
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => AVAILABLE_WIDTH,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => SHEET_HEIGHT,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * The sheet is not in the DOM on the first render — the screen shows a
   * "Loading…" placeholder until the invoice arrives — so the hook has to
   * measure once the nodes are actually there.
   */
  const Harness = () => {
    const [ready, setReady] = useState(false);
    const preview = usePrintPreviewScale();
    return (
      <div>
        <button type="button" onClick={() => setReady(true)}>
          mount
        </button>
        {ready ? (
          <div
            data-testid="wrapper"
            ref={preview.wrapperRef}
            style={preview.wrapperStyle}
          >
            <div
              data-testid="sheet"
              ref={preview.sheetRef}
              style={preview.sheetStyle}
            />
          </div>
        ) : null}
      </div>
    );
  };

  it('scales the sheet down to the space the page has', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'mount' }));

    const sheet = await screen.findByTestId('sheet');
    const scale = AVAILABLE_WIDTH / A4_PREVIEW_WIDTH_PX;
    expect(sheet.style.transform).toBe(`scale(${scale})`);
    expect(sheet.style.transformOrigin).toBe('top left');
    expect(sheet.style.width).toBe(`${A4_PREVIEW_WIDTH_PX}px`);
  });

  it('clips the scaled sheet and reserves its scaled height', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'mount' }));

    const wrapper = await screen.findByTestId('wrapper');
    const scale = AVAILABLE_WIDTH / A4_PREVIEW_WIDTH_PX;
    expect(wrapper.style.overflow).toBe('hidden');
    expect(Number.parseFloat(wrapper.style.height)).toBeCloseTo(
      SHEET_HEIGHT * scale,
      1,
    );
  });

  it('measures once the sheet mounts, not before', async () => {
    render(<Harness />);
    // nothing to measure yet — the sheet is not in the DOM
    expect(screen.queryByTestId('sheet')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'mount' }));
    const sheet = await screen.findByTestId('sheet');
    await waitFor(() => {
      expect(sheet.style.transform).not.toBe('');
    });
    expect(sheet.style.transform).not.toBe('scale(1)');
  });
});
