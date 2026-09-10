/**
 * PartyBalanceIndicator: compact outstanding-balance hint under the party
 * select on New Invoice. Covers: shows on selection, red tint for large Dr,
 * "No balance" for zero/no-history, hides when nothing selected, sums family.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { BalanceType } from 'types';

import {
  LARGE_DR_BALANCE_THRESHOLD,
  PartyBalanceIndicator,
} from '../components/PartyBalanceIndicator';

type LedgerBalance = { balance: number; balanceType: BalanceType } | null;

function setElectronBalance(result: LedgerBalance) {
  const getLedgerBalance = jest.fn(async () => result);
  const getItemTypes = jest.fn(async () => [{ id: 1, name: 'T' }]);
  const getLedgerBalancesForAccountIds = jest.fn(async () => ({}));
  (
    window as unknown as {
      electron: {
        getLedgerBalance: jest.Mock;
        getItemTypes: jest.Mock;
        getLedgerBalancesForAccountIds: jest.Mock;
      };
    }
  ).electron = {
    getLedgerBalance,
    getItemTypes,
    getLedgerBalancesForAccountIds,
  };
  return {
    getLedgerBalance,
    getItemTypes,
    getLedgerBalancesForAccountIds,
  };
}

describe('PartyBalanceIndicator', () => {
  it('renders nothing and skips the IPC when no account is selected', () => {
    const { getLedgerBalance } = setElectronBalance({
      balance: 100,
      balanceType: BalanceType.Dr,
    });
    const { container } = render(<PartyBalanceIndicator accountId={0} />);
    expect(container).toBeEmptyDOMElement();
    expect(getLedgerBalance).not.toHaveBeenCalled();
  });

  it('shows the latest balance with Dr/Cr marker once an account is selected', async () => {
    const { getLedgerBalance } = setElectronBalance({
      balance: 13498,
      balanceType: BalanceType.Dr,
    });
    render(<PartyBalanceIndicator accountId={10} />);

    const el = await screen.findByText(/Balance:/);
    expect(getLedgerBalance).toHaveBeenCalledWith(10);
    expect(el).toHaveTextContent(/Dr/);
    // below the large-Dr threshold: muted, not red
    expect(el.className).toContain('text-muted-foreground');
    expect(el.className).not.toContain('text-red-600');
  });

  it('red-tints large Dr balances', async () => {
    setElectronBalance({
      balance: LARGE_DR_BALANCE_THRESHOLD,
      balanceType: BalanceType.Dr,
    });
    render(<PartyBalanceIndicator accountId={11} />);

    const el = await screen.findByText(/Balance:/);
    expect(el.className).toContain('text-red-600');
  });

  it('does not red-tint large Cr balances', async () => {
    setElectronBalance({
      balance: LARGE_DR_BALANCE_THRESHOLD * 2,
      balanceType: BalanceType.Cr,
    });
    render(<PartyBalanceIndicator accountId={12} />);

    const el = await screen.findByText(/Balance:/);
    expect(el).toHaveTextContent(/Cr/);
    expect(el.className).not.toContain('text-red-600');
  });

  it('shows "No balance" for an account without ledger history', async () => {
    setElectronBalance(null);
    render(<PartyBalanceIndicator accountId={13} />);

    expect(await screen.findByText('No balance')).toBeInTheDocument();
  });

  it('shows "No balance" for a zero balance', async () => {
    setElectronBalance({ balance: 0, balanceType: BalanceType.Dr });
    render(<PartyBalanceIndicator accountId={14} />);

    expect(await screen.findByText('No balance')).toBeInTheDocument();
  });

  it('hides again when the selection is cleared', async () => {
    setElectronBalance({ balance: 500, balanceType: BalanceType.Cr });
    const { container, rerender } = render(
      <PartyBalanceIndicator accountId={15} />,
    );
    await screen.findByText(/Balance:/);

    rerender(<PartyBalanceIndicator accountId={undefined} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('re-fetches when refreshKey bumps without changing accountId', async () => {
    const { getLedgerBalance } = setElectronBalance({
      balance: 100,
      balanceType: BalanceType.Dr,
    });
    const { rerender } = render(
      <PartyBalanceIndicator accountId={20} refreshKey={0} />,
    );
    await screen.findByText(/Balance:/);
    expect(getLedgerBalance).toHaveBeenCalledTimes(1);

    getLedgerBalance.mockResolvedValue({
      balance: 250,
      balanceType: BalanceType.Dr,
    });
    rerender(<PartyBalanceIndicator accountId={20} refreshKey={1} />);

    await waitFor(() => {
      expect(getLedgerBalance).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText(/Balance:/)).toHaveTextContent(
      /250|250\.00/,
    );
  });

  it('sums balances across code-matched family only (not same display name)', async () => {
    const { getLedgerBalance, getLedgerBalancesForAccountIds, getItemTypes } =
      setElectronBalance({
        balance: 999,
        balanceType: BalanceType.Dr,
      });
    getItemTypes.mockResolvedValue([
      { id: 1, name: 'T' },
      { id: 2, name: 'TT' },
    ]);
    getLedgerBalancesForAccountIds.mockResolvedValue({
      10: { balance: 91708, balanceType: BalanceType.Dr },
      11: { balance: 14231, balanceType: BalanceType.Dr },
    });

    // two shops share trade name "MAKTABA USMANIA" — only KAR-* is this party
    const partyAccounts = [
      { id: 10, name: 'MAKTABA USMANIA', code: 'KAR-USMANIA', chartId: 14 },
      { id: 11, name: 'MAKTABA USMANIA', code: 'KAR-USMANIA-T', chartId: 14 },
      { id: 20, name: 'MAKTABA USMANIA', code: 'RWP-USMANIA', chartId: 10 },
      {
        id: 21,
        name: 'MAKTABA USMANIA-T',
        code: 'RWP-USMANIA-T',
        chartId: 10,
      },
    ];

    render(
      <PartyBalanceIndicator accountId={10} partyAccounts={partyAccounts} />,
    );

    const el = await screen.findByText(/Balance \(all\):/);
    expect(getLedgerBalance).not.toHaveBeenCalled();
    expect(getLedgerBalancesForAccountIds).toHaveBeenCalledWith([10, 11]);
    // 91708 + 14231 = 105939 Dr — must NOT include RWP-T 16576
    expect(el).toHaveTextContent(/Dr/);
    expect(el).toHaveTextContent(/105,939|105939/);
  });
});
