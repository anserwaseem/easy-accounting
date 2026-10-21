/**
 * @jest-environment jsdom
 *
 * Sales Performance report page. Covers the two things that were wrong:
 *
 *  - the Top Items search looked at `groupName`/`groupCode`, which are
 *    customer-table fields. Top-item rows carry `itemName`, so every typed
 *    term matched nothing and the tab emptied itself. The test types into
 *    the search and checks the row survives.
 *  - the report is an advanced control, so the page is only reachable when
 *    the capability is on (the route gate itself is covered by
 *    AdvancedGates.test.tsx).
 */
import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AdvancedCapabilitiesProvider } from '@/renderer/hooks/useAdvancedCapabilities';
import { ADVANCED_CAPABILITIES } from '@/core/advancedCapabilities';

const reportGetSalesPerformance = jest.fn();

jest.mock('renderer/shad/ui/datePicker', () => ({
  DateRangePickerWithPresets: () => <div data-testid="date-picker" />,
}));

jest.mock('renderer/components/ReportLayout', () => ({
  ReportLayout: ({ header, children }: any) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));

jest.mock('renderer/lib/reportExport', () => ({
  exportReportToExcel: jest.fn(),
}));

// recharts needs a real layout engine it cannot have in jsdom
jest.mock('recharts', () => ({
  LineChart: ({ children }: any) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  Legend: () => null,
}));

// the component under test (after mocks)
// eslint-disable-next-line import/first
import SalesPerformanceReportPage from '../index';

const TOP_ITEMS = [
  { itemName: 'S-24-TA', itemId: 1, totalQty: 10, totalAmount: 5000 },
  { itemName: 'Golden Card', itemId: 2, totalQty: 4, totalAmount: 2000 },
];

const RESPONSE = {
  kpis: {
    postedSalesAmount: 7000,
    qtySold: 14,
    invoiceCount: 2,
    avgInvoiceAmount: 3500,
    returnedInvoiceCount: 0,
  },
  series: [],
  rows: [
    {
      groupName: 'MAKTABA AYESHA',
      groupCode: 101,
      totalAmount: 7000,
      invoiceCount: 2,
    },
  ],
  topItems: TOP_ITEMS,
  returns: [],
  quotationBacklog: [],
  anomalies: [],
  exportRows: [],
};

const getAdvancedCapabilities = jest.fn();

const setupElectron = (): void => {
  (window as any).electron = {
    reportGetSalesPerformance,
    getAdvancedCapabilities,
    setAdvancedCapabilities: jest.fn().mockResolvedValue(undefined),
    store: {
      get: jest.fn(() => undefined),
      set: jest.fn(),
      delete: jest.fn(),
    },
  };
};

const renderPage = async () => {
  const result = render(
    <MemoryRouter>
      <AdvancedCapabilitiesProvider>
        <SalesPerformanceReportPage />
      </AdvancedCapabilitiesProvider>
    </MemoryRouter>,
  );
  await screen.findByText('Sales Performance');
  return result;
};

describe('SalesPerformancePage', () => {
  beforeEach(() => {
    reportGetSalesPerformance.mockReset();
    reportGetSalesPerformance.mockResolvedValue(RESPONSE);
    getAdvancedCapabilities.mockReset();
    getAdvancedCapabilities.mockResolvedValue([
      ADVANCED_CAPABILITIES.salesPerformanceReport,
    ]);
    setupElectron();
  });

  it('searches top items by item name', async () => {
    await renderPage();

    // open the Top Items tab
    fireEvent.click(screen.getByRole('button', { name: /Top Items/i }));

    const search = await screen.findByPlaceholderText('Search items...');
    fireEvent.change(search, { target: { value: 'golden' } });

    // the debounce is 300ms; the record count is the table's own summary
    await waitFor(
      () => {
        expect(
          screen.getByText(/Showing 1 out of 2 records/),
        ).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    // and the row that does not match is gone
    expect(screen.queryByText('S-24-TA')).not.toBeInTheDocument();
  });

  it('keeps a top item that matches the search', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Top Items/i }));

    const search = await screen.findByPlaceholderText('Search items...');
    fireEvent.change(search, { target: { value: 'S-24' } });

    await waitFor(
      () => {
        expect(
          screen.getByText(/Showing 1 out of 2 records/),
        ).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    expect(screen.queryByText('Golden Card')).not.toBeInTheDocument();
  });

  it('shows every top item when the search is cleared', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: /Top Items/i }));

    const search = await screen.findByPlaceholderText('Search items...');
    fireEvent.change(search, { target: { value: 'golden' } });

    await waitFor(
      () => {
        expect(
          screen.getByText(/Showing 1 out of 2 records/),
        ).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    fireEvent.change(search, { target: { value: '' } });

    await waitFor(
      () => {
        expect(screen.getByText(/Total records: 2/)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});
