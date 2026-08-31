/**
 * @jest-environment jsdom
 *
 * The palette exists so a lookup never needs a page navigation first, which
 * only holds if it opens from anywhere (even with an input focused), loads its
 * data lazily, filters like the Inventory search, and lands on the right route.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Account, InventoryItem, InvoicesView } from 'types';
import { InvoiceType } from 'types';
import GlobalSearch, { resetGlobalSearchDataCache } from '../GlobalSearch';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

// synthetic fixtures mimicking real patterns (multi-word names, numeric codes)
const account = (id: number, name: string, code?: number): Account =>
  ({ id, name, code }) as Account;

const item = (id: number, name: string): InventoryItem =>
  ({ id, name }) as InventoryItem;

const invoice = (id: number, invoiceNumber: number, accountName: string) =>
  ({ id, invoiceNumber, accountName }) as unknown as InvoicesView;

const accounts = [
  account(1, 'BLUE PAPER MART', 786),
  account(2, 'GREEN BOOK CENTRE', 431),
  // enough matches for "depot" to overflow the per-group cap
  ...Array.from({ length: 12 }, (_, i) =>
    account(100 + i, `PAPER DEPOT ${i + 1}`, 900 + i),
  ),
];
const inventory = [item(11, 'REXINE 16 LINES'), item(12, 'ART CARD COVER')];
// party names distinct from the account fixtures so every rendered text is unique
const saleInvoices = [invoice(21, 501, 'CANAL STATIONERS')];
const purchaseInvoices = [invoice(31, 77, 'RIVERSIDE PRINTERS')];

const getAccounts = jest.fn();
const getInventory = jest.fn();
const getInvoices = jest.fn();

const openPalette = () =>
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

const renderAndOpen = async () => {
  const view = render(<GlobalSearch />);
  openPalette();
  await screen.findByText('BLUE PAPER MART');
  return view;
};

const searchInput = () =>
  screen.getByPlaceholderText('Search accounts, inventory, invoices...');

describe('GlobalSearch', () => {
  beforeAll(() => {
    // jsdom implements neither; cmdk scrolls the selected item into view and
    // measures its list with a ResizeObserver
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
    (global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {} // eslint-disable-line class-methods-use-this

      unobserve() {} // eslint-disable-line class-methods-use-this

      disconnect() {} // eslint-disable-line class-methods-use-this
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetGlobalSearchDataCache();
    getAccounts.mockResolvedValue(accounts);
    getInventory.mockResolvedValue(inventory);
    getInvoices.mockImplementation((invoiceType: InvoiceType) =>
      Promise.resolve(
        invoiceType === InvoiceType.Sale ? saleInvoices : purchaseInvoices,
      ),
    );
    window.electron = {
      getAccounts,
      getInventory,
      getInvoices,
    } as unknown as Window['electron'];
  });

  it('stays closed and loads nothing until Ctrl/Cmd+K', () => {
    render(<GlobalSearch />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getAccounts).not.toHaveBeenCalled();
    expect(getInventory).not.toHaveBeenCalled();
    expect(getInvoices).not.toHaveBeenCalled();
  });

  it('opens on Ctrl+K and lazily loads all three datasets', async () => {
    await renderAndOpen();

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(getAccounts).toHaveBeenCalledTimes(1);
    expect(getInventory).toHaveBeenCalledTimes(1);
    expect(getInvoices).toHaveBeenCalledWith(InvoiceType.Sale);
    expect(getInvoices).toHaveBeenCalledWith(InvoiceType.Purchase);
  });

  it('opens even while an unrelated input has focus', async () => {
    render(
      <div>
        <input aria-label="page search" />
        <GlobalSearch />
      </div>,
    );
    const input = screen.getByLabelText('page search');
    input.focus();

    fireEvent.keyDown(input, { key: 'k', ctrlKey: true });

    expect(await screen.findByText('BLUE PAPER MART')).toBeTruthy();
  });

  it('reuses the session cache instead of refetching on remount', async () => {
    const { unmount } = await renderAndOpen();
    unmount();

    await renderAndOpen();

    expect(getAccounts).toHaveBeenCalledTimes(1);
    expect(getInventory).toHaveBeenCalledTimes(1);
    // once per invoice type
    expect(getInvoices).toHaveBeenCalledTimes(2);
  });

  it('filters all groups with case-insensitive multi-word contains', async () => {
    await renderAndOpen();

    // word order does not matter, and each word may hit a different field
    fireEvent.change(searchInput(), { target: { value: 'paper blue' } });
    expect(screen.getByText('BLUE PAPER MART')).toBeTruthy();
    expect(screen.queryByText('GREEN BOOK CENTRE')).toBeNull();
    expect(screen.queryByText('Sale #501')).toBeNull();
    expect(screen.queryByText('REXINE 16 LINES')).toBeNull();

    // an invoice is also found through its party's name
    fireEvent.change(searchInput(), { target: { value: 'canal' } });
    expect(screen.getByText('Sale #501')).toBeTruthy();
    expect(screen.queryByText('BLUE PAPER MART')).toBeNull();
  });

  it('finds accounts by code and invoices by number', async () => {
    await renderAndOpen();

    fireEvent.change(searchInput(), { target: { value: '431' } });
    expect(screen.getByText('GREEN BOOK CENTRE')).toBeTruthy();
    expect(screen.queryByText('BLUE PAPER MART')).toBeNull();

    fireEvent.change(searchInput(), { target: { value: '77' } });
    expect(screen.getByText('Purchase #77')).toBeTruthy();
    expect(screen.queryByText('Sale #501')).toBeNull();
  });

  it('shows the empty state when nothing matches', async () => {
    await renderAndOpen();

    fireEvent.change(searchInput(), { target: { value: 'zzz-no-such-thing' } });

    expect(screen.getByText('No results found.')).toBeTruthy();
  });

  it('caps each group at 8 rendered results', async () => {
    await renderAndOpen();

    fireEvent.change(searchInput(), { target: { value: 'depot' } });

    expect(screen.getAllByText(/PAPER DEPOT/)).toHaveLength(8);
  });

  it('navigates to the account ledger and closes on select', async () => {
    await renderAndOpen();

    fireEvent.click(screen.getByText('BLUE PAPER MART'));

    expect(mockNavigate).toHaveBeenCalledWith('/accounts/1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('navigates to sale and purchase invoice details by row id', async () => {
    await renderAndOpen();
    fireEvent.click(screen.getByText('Sale #501'));
    expect(mockNavigate).toHaveBeenCalledWith('/sale/invoices/21');

    openPalette();
    fireEvent.click(await screen.findByText('Purchase #77'));
    expect(mockNavigate).toHaveBeenCalledWith('/purchase/invoices/31');
  });

  it('navigates to the inventory page for an item', async () => {
    await renderAndOpen();

    fireEvent.click(screen.getByText('REXINE 16 LINES'));

    expect(mockNavigate).toHaveBeenCalledWith('/inventory');
  });

  it('closes on Escape and clears the query for the next open', async () => {
    await renderAndOpen();
    fireEvent.change(searchInput(), { target: { value: 'blue' } });

    fireEvent.keyDown(searchInput(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    openPalette();
    expect(
      (
        (await screen.findByPlaceholderText(
          'Search accounts, inventory, invoices...',
        )) as HTMLInputElement
      ).value,
    ).toBe('');
  });
});
