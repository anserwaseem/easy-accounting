import { store } from '../../store';
import { connect } from '../Database.service';
import { getAccounts, insertAccount, updateAccount } from '../Account.service';
import { cast } from '../../utils/sqlite';

jest.mock('../Database.service');
jest.mock('../../store');

describe('Account Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return an array of accounts', () => {
    const expectedAccounts = [
      {
        id: 1,
        name: 'Account 1',
        headName: 'Head 1',
        chartId: 1,
        type: 'Type 1',
        code: '001',
        createdAt: '2021-01-01',
        updatedAt: '2021-01-02',
      },
      {
        id: 2,
        name: 'Account 2',
        headName: 'Head 2',
        chartId: 2,
        type: 'Type 2',
        code: '002',
        createdAt: '2021-02-01',
        updatedAt: '2021-02-02',
      },
    ];
    const mockAll = jest.fn().mockReturnValue(expectedAccounts);
    const mockPrepare = jest.fn().mockReturnValue({ all: mockAll });
    (connect as jest.Mock).mockReturnValue({ prepare: mockPrepare });
    (store.get as jest.Mock).mockReturnValue('testUser');

    const accounts = getAccounts();

    expect(store.get).toHaveBeenCalledWith('username');
    expect(mockAll).toHaveBeenCalledWith({ username: 'testUser' });
    expect(accounts).toEqual(expectedAccounts);
  });

  it('should return true on successful insertion', () => {
    const mockRun = jest.fn().mockReturnValue({ lastInsertRowid: 1 });
    const mockPrepare = jest.fn().mockReturnValue({ run: mockRun });
    (connect as jest.Mock).mockReturnValue({ prepare: mockPrepare });
    const account = { name: 'Cash in hand', headName: 'Cash', code: 101 };

    const result = insertAccount(account);

    expect(mockRun).toHaveBeenCalledWith(account);
    expect(result).toBe(true);
  });

  it('should return true on successful update', () => {
    const mockRun = jest.fn().mockReturnValue({ changes: 1 });
    const mockPrepare = jest.fn().mockReturnValue({ run: mockRun });
    (connect as jest.Mock).mockReturnValue({ prepare: mockPrepare });

    const sampleAccount = {
      id: 10,
      name: 'Cash in hand',
      headName: 'Cash',
      code: 101,
    };
    const result = updateAccount(sampleAccount);

    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: cast(sampleAccount.id) }),
    ); // Ensure the correct parameters are passed
    expect(result).toBe(true);
  });
});
