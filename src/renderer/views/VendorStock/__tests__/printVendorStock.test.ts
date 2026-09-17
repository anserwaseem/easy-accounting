import type { VendorStockRow } from 'types';
import { printVendorStockIframe } from '../printVendorStock';

const row = (overrides: Partial<VendorStockRow> = {}): VendorStockRow => ({
  vendorAccountId: 1,
  vendorAccountName: 'Printer Co',
  inventoryId: 10,
  inventoryName: 'Quran 16 line',
  quantity: 12,
  ...overrides,
});

describe('printVendorStockIframe', () => {
  let written: string;
  let print: jest.Mock;
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    written = '';
    print = jest.fn();
    jest.useFakeTimers();

    const fakeDoc = {
      open: jest.fn(),
      write: (html: string) => {
        written = html;
      },
      close: jest.fn(),
    };
    const fakeWin = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      focus: jest.fn(),
      print,
    };

    jest.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'iframe') {
        return originalCreateElement(tag);
      }
      return {
        setAttribute: jest.fn(),
        style: {},
        contentDocument: fakeDoc,
        contentWindow: fakeWin,
        remove: jest.fn(),
      } as unknown as HTMLIFrameElement;
    }) as typeof document.createElement);
    jest.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('skips print when no rows', () => {
    printVendorStockIframe({
      rows: [],
      vendorLabel: 'Printer Co',
      totalQty: 0,
      includeVendor: false,
    });
    expect(document.createElement).not.toHaveBeenCalled();
  });

  it('prints item and qty in three columns for one vendor', () => {
    printVendorStockIframe({
      rows: [row()],
      vendorLabel: 'Printer Co',
      totalQty: 12,
      includeVendor: false,
    });
    jest.runOnlyPendingTimers();

    expect(written).toContain('Vendor Stock: Printer Co');
    expect(written).toContain('<th>Item</th>');
    expect(written).toContain('Quran 16 line');
    expect(written).toContain('Total quantity: 12');
    expect(written).not.toContain('<th>Vendor</th>');
    expect(written).toContain('repeat(3, minmax(0, 1fr))');
    expect(print).toHaveBeenCalled();
  });

  it('includes vendor column when printing all vendors', () => {
    printVendorStockIframe({
      rows: [
        row(),
        row({
          vendorAccountId: 2,
          vendorAccountName: 'Bindery',
          inventoryId: 11,
          quantity: 4,
        }),
      ],
      vendorLabel: 'All tracked vendors',
      totalQty: 16,
      includeVendor: true,
    });
    jest.runOnlyPendingTimers();

    expect(written).toContain('<th>Vendor</th>');
    expect(written).toContain('Printer Co');
    expect(written).toContain('Bindery');
    expect(written).toContain('repeat(2, minmax(0, 1fr))');
    expect(written).toContain('Total quantity: 16');
  });
});
