import { BalanceSheet } from 'types';
import { saveBalanceSheet } from '../Statement.service';
import { connect } from '../Database.service';
import { store } from '../../store';

jest.mock('../Database.service');
jest.mock('../../store');

describe('Statement Service', () => {
  const mockRun = jest.fn().mockReturnValue({ lastInsertRowid: 1 });
  const mockPrepare = jest.fn().mockReturnValue({ run: mockRun });
  const mockTransaction = jest.fn((callback) => callback);

  beforeEach(() => {
    jest.clearAllMocks();
    (connect as jest.Mock).mockReturnValue({
      prepare: mockPrepare,
      transaction: mockTransaction,
    });
    (store.get as jest.Mock).mockReturnValue('testuser');
  });

  it('should handle empty balance sheet sections', () => {
    const emptyRecord = {
      current: {},
      fixed: {},
      totalCurrent: 0,
      totalFixed: 0,
      total: 0,
    };
    const balanceSheet: BalanceSheet = {
      date: new Date(),
      assets: emptyRecord,
      liabilities: emptyRecord,
      equity: emptyRecord,
    };

    const result = saveBalanceSheet(balanceSheet);

    expect(result).toBe(true);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('should save a balance sheet successfully', () => {
    const balanceSheet: BalanceSheet = {
      date: new Date('2023-06-24'),
      assets: {
        current: {
          'Cash and Bank': [
            { name: 'Cash', amount: 1000 },
            { name: 'Bank', amount: 5000 },
          ],
        },
        fixed: {
          'Property, Plant and Equipment': [
            { name: 'Building', amount: 100000 },
          ],
        },
        totalCurrent: 6000,
        totalFixed: 100000,
        total: 106000,
      },
      liabilities: {
        current: {
          'Accounts Payable': [{ name: 'Supplier A', amount: 2000 }],
        },
        fixed: {
          'Long-term Loans': [{ name: 'Bank Loan', amount: 50000 }],
        },
        totalCurrent: 2000,
        totalFixed: 50000,
        total: 52000,
      },
      equity: {
        current: {
          '': [{ name: "Owner's Capital", amount: 54000 }],
        },
        total: 54000,
      },
    };

    const result = saveBalanceSheet(balanceSheet);

    expect(result).toBe(true);
    expect(connect).toHaveBeenCalled();
    expect(store.get).toHaveBeenCalledWith('username');
    expect(mockPrepare).toHaveBeenCalledTimes(4);
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalledTimes(17); // 5 charts + 6 accounts + 3 debit entries + 3 credit entries

    // Current Assets
    // Create Chart
    expect(mockRun).toHaveBeenCalledWith({
      date: new Date('2023-06-24').toISOString(),
      name: 'Cash and Bank',
      type: 'Asset',
    });
    // Create first Account
    expect(mockRun).toHaveBeenCalledWith({
      chartId: 1,
      date: new Date('2023-06-24').toISOString(),
      name: 'Cash',
    });
    // Create first Ledger Entry
    expect(mockRun).toHaveBeenCalledWith({
      date: new Date('2023-06-24').toISOString(),
      particulars: 'Opening Balance from B/S',
      accountId: 1,
      debit: 1000,
      balance: 1000,
    });
    // Create second Account
    expect(mockRun).toHaveBeenCalledWith({
      chartId: 1,
      date: new Date('2023-06-24').toISOString(),
      name: 'Bank',
    });
    // Create second Ledger Entry
    expect(mockRun).toHaveBeenCalledWith({
      date: new Date('2023-06-24').toISOString(),
      particulars: 'Opening Balance from B/S',
      accountId: 1,
      debit: 5000,
      balance: 5000,
    });

    // Fixed Assets
    // Create Chart
    expect(mockRun).toHaveBeenCalledWith({
      date: new Date('2023-06-24').toISOString(),
      name: 'Property, Plant and Equipment',
      type: 'Asset',
    });
    // Create first Account
    expect(mockRun).toHaveBeenCalledWith({
      chartId: 1,
      date: new Date('2023-06-24').toISOString(),
      name: 'Building',
    });
    // Create first Ledger Entry
    expect(mockRun).toHaveBeenCalledWith({
      date: new Date('2023-06-24').toISOString(),
      particulars: 'Opening Balance from B/S',
      accountId: 1,
      debit: 100000,
      balance: 100000,
    });

    // Current Liabilities
    // Create Chart
    expect(mockRun).toHaveBeenCalledWith({
      date: new Date('2023-06-24').toISOString(),
      name: 'Accounts Payable',
      type: 'Liability',
    });
    // Create first Account
    expect(mockRun).toHaveBeenCalledWith({
      chartId: 1,
      date: new Date('2023-06-24').toISOString(),
      name: 'Supplier A',
    });
    // Create first Ledger Entry
    expect(mockRun).toHaveBeenCalledWith({
      date: new Date('2023-06-24').toISOString(),
      particulars: 'Opening Balance from B/S',
      accountId: 1,
      credit: 2000,
      balance: 2000,
    });

    // Fixed Liabilities
    // Create Chart
    expect(mockRun).toHaveBeenCalledWith({
      date: new Date('2023-06-24').toISOString(),
      name: 'Long-term Loans',
      type: 'Liability',
    });
    // Create first Account
    expect(mockRun).toHaveBeenCalledWith({
      chartId: 1,
      date: new Date('2023-06-24').toISOString(),
      name: 'Bank Loan',
    });
    // Create first Ledger Entry
    expect(mockRun).toHaveBeenCalledWith({
      date: new Date('2023-06-24').toISOString(),
      particulars: 'Opening Balance from B/S',
      accountId: 1,
      credit: 50000,
      balance: 50000,
    });

    // Equity
    // Create Chart
    expect(mockRun).toHaveBeenCalledWith({
      date: new Date('2023-06-24').toISOString(),
      name: 'Equity',
      type: 'Equity',
    });
    // Create Account
    expect(mockRun).toHaveBeenCalledWith({
      chartId: 1,
      date: new Date('2023-06-24').toISOString(),
      name: "Owner's Capital",
    });
    // Create Ledger Entry
    expect(mockRun).toHaveBeenCalledWith({
      date: new Date('2023-06-24').toISOString(),
      particulars: 'Opening Balance from B/S',
      accountId: 1,
      credit: 54000,
      balance: 54000,
    });
  });
});
