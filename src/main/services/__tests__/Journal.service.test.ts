import { BalanceType, Journal } from 'types';
import { SqliteBoolean } from '@/main/utils/sqlite';
import {
  getNextJournalId,
  insertJournal,
  getJournals,
  getJorunal,
} from '../Journal.service';
import { connect } from '../Database.service';
import { store } from '../../store';

jest.mock('../Database.service');
jest.mock('../../store');

describe('Journal Service', () => {
  const mockDb = {
    prepare: jest.fn(),
    transaction: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (connect as jest.Mock).mockReturnValue(mockDb);
  });

  describe('getNextJournalId', () => {
    it('should return the next journal ID', () => {
      const mockGet = jest.fn().mockReturnValue({ id: 5 });
      mockDb.prepare.mockReturnValue({ get: mockGet });

      const result = getNextJournalId();

      expect(result).toBe(6);
    });

    it('should return 1 if no journals exist', () => {
      const mockGet = jest.fn().mockReturnValue(undefined);
      mockDb.prepare.mockReturnValue({ get: mockGet });

      const result = getNextJournalId();

      expect(result).toBe(1);
    });
  });

  describe('insertJournal', () => {
    it('should insert a journal successfully', () => {
      const mockRun = jest.fn().mockReturnValue({ lastInsertRowid: 1 });
      const mockGet = jest.fn().mockReturnValue({ balance: 0 });
      mockDb.prepare.mockReturnValue({ run: mockRun, get: mockGet });
      mockDb.transaction.mockImplementation((cb) => cb);

      const journal: Journal = {
        id: 1,
        date: '2023-06-23',
        narration: 'Test Journal',
        isPosted: true,
        journalEntries: [
          {
            id: 1,
            debitAmount: 100,
            creditAmount: 0,
            accountId: 1,
            journalId: 1,
          },
          {
            id: 2,
            debitAmount: 0,
            creditAmount: 100,
            accountId: 2,
            journalId: 1,
          },
        ],
      };

      const result = insertJournal(journal);

      expect(result).toBe(true);
      expect(mockDb.transaction).toHaveBeenCalled();
      expect(mockDb.prepare).toHaveBeenCalledTimes(4);

      // Check journal insertion
      expect(mockRun).toHaveBeenCalledWith({
        date: '2023-06-23',
        narration: 'Test Journal',
        isPosted: 1 as SqliteBoolean as any,
      });

      // Check first journal entry insertion
      expect(mockRun).toHaveBeenCalledWith({
        journalId: 1,
        debitAmount: 100,
        accountId: 1,
        creditAmount: 0,
      });

      // Check ledger entry insertions
      expect(mockRun).toHaveBeenCalledWith({
        date: '2023-06-23',
        accountId: 1,
        debit: 100,
        credit: 0,
        balance: 100,
        balanceType: BalanceType.Dr,
        particulars: 'Journal #1',
        linkedAccountId: 2,
      });
      expect(mockRun).toHaveBeenCalledWith({
        date: '2023-06-23',
        accountId: 2,
        debit: 0,
        credit: 100,
        balance: 100,
        balanceType: BalanceType.Cr,
        particulars: 'Journal #1',
        linkedAccountId: 1,
      });

      // Check second journal entry insertion
      expect(mockRun).toHaveBeenCalledWith({
        journalId: 1,
        debitAmount: 0,
        accountId: 2,
        creditAmount: 100,
      });
    });
  });

  describe('getJournals', () => {
    it('should return all journals', () => {
      const mockAll = jest.fn().mockReturnValue([
        { id: 1, date: '2023-06-23', narration: 'Journal 1', isPosted: true },
        { id: 1, date: '2023-06-23', narration: 'Journal 1', isPosted: true },
        { id: 2, date: '2023-06-24', narration: 'Journal 2', isPosted: true },
      ] as Journal[]);
      mockDb.prepare.mockReturnValue({ all: mockAll });
      (store.get as jest.Mock).mockReturnValue('testuser');

      const result = getJournals();

      expect(result).toHaveLength(2);
      expect(store.get).toHaveBeenCalledWith('username');
    });
  });

  describe('getJorunal', () => {
    it('should return a specific journal', () => {
      const mockAll = jest.fn().mockReturnValue([
        {
          id: 1,
          date: '2023-06-23',
          narration: 'Test Journal',
          isPosted: true,
          debitAmount: 100,
          creditAmount: 0,
          accountId: 1,
          accountName: 'Test Account 1',
        },
        {
          id: 1,
          date: '2023-06-23',
          narration: 'Test Journal',
          isPosted: true,
          debitAmount: 0,
          creditAmount: 100,
          accountId: 2,
          accountName: 'Test Account 2',
        },
      ]);
      mockDb.prepare.mockReturnValue({ all: mockAll });
      (store.get as jest.Mock).mockReturnValue('testuser');

      const result = getJorunal(1);

      expect(result.id).toBe(1);
      expect(result.journalEntries).toHaveLength(2);
      expect(store.get).toHaveBeenCalledWith('username');
    });
  });
});
