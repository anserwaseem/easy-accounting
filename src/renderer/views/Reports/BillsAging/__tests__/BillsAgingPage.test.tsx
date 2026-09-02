/**
 * BillsAgingPage: customer-first filter row. Covers: the "All parties" default
 * scope with its empty-selection guard, the customer selector rendering before
 * the head selector, disambiguated option labels (name + code + head) under
 * All parties, and plain labels once a specific head is chosen.
 */
import '@testing-library/jest-dom';
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';

import {
  ALL_PARTIES_HEAD,
  ALL_PARTIES_EMPTY_SELECTION_MESSAGE,
} from '../useBillsAging';

// captured props of the mocked selectors, refreshed on every render
let customerSelectProps: any;
let headSelectProps: any;

jest.mock('renderer/components/VirtualMultiSelect', () => ({
  __esModule: true,
  default: (props: any) => {
    customerSelectProps = props;
    return <div data-testid="customer-select">{props.placeholder}</div>;
  },
}));

jest.mock('renderer/shad/ui/select', () => ({
  Select: ({ children, value, onValueChange }: any) => {
    headSelectProps = { value, onValueChange };
    return (
      <div data-testid="head-select" data-value={value}>
        {children}
      </div>
    );
  },
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => (
    <div data-testid="head-option" data-value={value}>
      {children}
    </div>
  ),
  SelectValue: () => null,
}));

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

// component under test (after mocks)
// eslint-disable-next-line import/first
import BillsAgingPage from '../index';

const HEAD = "Shahbaz's Parties";
const OTHER_HEAD = "Ilyas's Parties";

const DUP_ACCOUNT_A = {
  id: 2001,
  name: 'KITAB GHAR',
  code: 'RWP-KITAB',
  headName: HEAD,
};
const DUP_ACCOUNT_B = {
  id: 2002,
  name: 'KITAB GHAR',
  code: 'LHR-KITAB',
  headName: OTHER_HEAD,
};

const setupElectron = (): void => {
  (window as any).electron = {
    getCharts: jest.fn(async () => [
      { id: 10, name: HEAD, parentId: 2 },
      { id: 11, name: OTHER_HEAD, parentId: 2 },
    ]),
    getAccounts: jest.fn(async () => [DUP_ACCOUNT_A, DUP_ACCOUNT_B]),
    getLedgerBalancesForAccountIdsAsOfDate: jest.fn(async () => ({
      [DUP_ACCOUNT_A.id]: { balance: 45000, balanceType: 'Dr' },
    })),
    getLedgerRangeForAccountIds: jest.fn(async () => ({})),
    getJournalNarrationSummariesByIds: jest.fn(async () => ({})),
  } as any;
};

describe('BillsAgingPage customer-first filters', () => {
  beforeEach(() => {
    customerSelectProps = undefined;
    headSelectProps = undefined;
    setupElectron();
  });

  it('defaults to All parties and shows the empty-selection guard instead of a report', async () => {
    render(<BillsAgingPage />);

    expect(
      await screen.findByText(ALL_PARTIES_EMPTY_SELECTION_MESSAGE),
    ).toBeInTheDocument();
    expect(screen.getByTestId('head-select')).toHaveAttribute(
      'data-value',
      ALL_PARTIES_HEAD,
    );

    // guard: nothing was computed for the ~all-accounts pool
    const { electron } = window as any;
    expect(electron.getLedgerRangeForAccountIds).not.toHaveBeenCalled();
  });

  it('renders the customer selector before the head selector', async () => {
    render(<BillsAgingPage />);
    await screen.findByText(ALL_PARTIES_EMPTY_SELECTION_MESSAGE);

    const customerSelect = screen.getByTestId('customer-select');
    const headSelect = screen.getByTestId('head-select');
    const position = customerSelect.compareDocumentPosition(headSelect);
    // eslint-disable-next-line no-bitwise
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers an "All parties" head option above the agent heads', async () => {
    render(<BillsAgingPage />);
    await screen.findByText(ALL_PARTIES_EMPTY_SELECTION_MESSAGE);

    const optionValues = screen
      .getAllByTestId('head-option')
      .map((option) => option.getAttribute('data-value'));
    expect(optionValues).toEqual([ALL_PARTIES_HEAD, HEAD, OTHER_HEAD]);
  });

  it('disambiguates all-parties options with name + code + head and searches the head too', async () => {
    render(<BillsAgingPage />);
    await screen.findByText(ALL_PARTIES_EMPTY_SELECTION_MESSAGE);

    await waitFor(() => expect(customerSelectProps.options).toHaveLength(2));
    expect(customerSelectProps.placeholder).toBe('Select customers');
    expect(customerSelectProps.searchFields).toEqual([
      'name',
      'code',
      'headName',
    ]);

    // the custom label renderer carries name + code + agent head
    const label = render(
      <div data-testid="option-label">
        {customerSelectProps.renderSelectItem(customerSelectProps.options[0])}
      </div>,
    );
    const labelText = label.getByTestId('option-label').textContent;
    expect(labelText).toContain('KITAB GHAR (RWP-KITAB)');
    expect(labelText).toContain(HEAD);
  });

  it('keeps plain labels and the computed-report options under a specific head', async () => {
    render(<BillsAgingPage />);
    await screen.findByText(ALL_PARTIES_EMPTY_SELECTION_MESSAGE);

    await act(async () => {
      headSelectProps.onValueChange(HEAD);
    });

    await waitFor(() =>
      expect(customerSelectProps.placeholder).toBe('All customers'),
    );
    expect(customerSelectProps.renderSelectItem).toBeUndefined();
    expect(customerSelectProps.searchFields).toBeUndefined();
    // options come from the computed report for that head only
    await waitFor(() =>
      expect(
        customerSelectProps.options.map((option: any) => option.id),
      ).toEqual([DUP_ACCOUNT_A.id]),
    );
  });
});
