import { BalanceType, Ledger } from 'types';
import { cast } from '../../utils/sqlite';
import { connect } from '../Database.service';
import { getLedger } from '../Ledger.service';

jest.mock('../Database.service');

describe('Chart Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return an array of charts', () => {
    const mockLedger: Ledger[] = [
      {
        id: 1,
        accountId: 1,
        particulars: 'Sample Entry',
        debit: 100,
        credit: 0,
        balance: 100,
        balanceType: BalanceType.Dr,
        date: cast(new Date('2024-03-02')),
        createdAt: new Date('2024-03-02'),
        updatedAt: new Date('2024-03-02'),
      },
    ];
    const mockAll = jest.fn().mockReturnValue(mockLedger);
    const mockPrepare = jest.fn().mockReturnValue({ all: mockAll });
    (connect as jest.Mock).mockReturnValue({ prepare: mockPrepare });

    const charts = getLedger(1);

    expect(mockAll).toHaveBeenCalledWith({ accountId: 1 });
    expect(charts).toEqual(mockLedger);
  });
});
