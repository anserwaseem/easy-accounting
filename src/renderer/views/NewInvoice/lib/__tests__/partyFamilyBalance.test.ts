import {
  getPartyFamilyAccountIds,
  ledgerBalanceToSignedDrPositive,
  sumLedgerBalances,
} from '../partyFamilyBalance';
import { BalanceType } from 'types';

describe('partyFamilyBalance', () => {
  const base = { id: 10, name: 'Acme', code: 'AC', chartId: 1 };
  const typedT = { id: 11, name: 'Acme-T', code: 'AC-T', chartId: 1 };
  const typedTt = { id: 12, name: 'Acme-TT', code: 'AC-TT', chartId: 1 };
  const other = { id: 20, name: 'Beta', code: 'BE', chartId: 1 };
  const accounts = [base, typedT, typedTt, other];
  const itemTypes = ['T', 'TT'];

  describe('getPartyFamilyAccountIds', () => {
    it('returns base + typed variants when base is selected', () => {
      expect(
        getPartyFamilyAccountIds(10, accounts, itemTypes).sort((a, b) => a - b),
      ).toEqual([10, 11, 12]);
    });

    it('returns same family when a typed variant is selected', () => {
      expect(
        getPartyFamilyAccountIds(12, accounts, itemTypes).sort((a, b) => a - b),
      ).toEqual([10, 11, 12]);
    });

    it('returns only itself for an untyped party with no variants', () => {
      expect(getPartyFamilyAccountIds(20, accounts, itemTypes)).toEqual([20]);
    });

    it('returns selected id alone when accounts list is empty', () => {
      expect(getPartyFamilyAccountIds(10, [], itemTypes)).toEqual([10]);
    });
  });

  describe('sumLedgerBalances', () => {
    it('nets Dr and Cr with Dr-positive signing', () => {
      expect(
        sumLedgerBalances({
          10: { balance: 10000, balanceType: BalanceType.Dr },
          11: { balance: 5000, balanceType: BalanceType.Dr },
          12: { balance: 2000, balanceType: BalanceType.Cr },
        }),
      ).toEqual({ balance: 13000, balanceType: BalanceType.Dr });
    });

    it('returns Cr when net is credit', () => {
      expect(
        sumLedgerBalances({
          10: { balance: 1000, balanceType: BalanceType.Dr },
          11: { balance: 4000, balanceType: BalanceType.Cr },
        }),
      ).toEqual({ balance: 3000, balanceType: BalanceType.Cr });
    });

    it('returns zero Dr when nets cancel', () => {
      expect(
        sumLedgerBalances({
          10: { balance: 5, balanceType: BalanceType.Dr },
          11: { balance: 5, balanceType: BalanceType.Cr },
        }),
      ).toEqual({ balance: 0, balanceType: BalanceType.Dr });
    });

    it('returns null for empty map', () => {
      expect(sumLedgerBalances({})).toBeNull();
    });
  });

  describe('ledgerBalanceToSignedDrPositive', () => {
    it('maps Dr positive and Cr negative', () => {
      expect(
        ledgerBalanceToSignedDrPositive({
          balance: 12,
          balanceType: BalanceType.Dr,
        }),
      ).toBe(12);
      expect(
        ledgerBalanceToSignedDrPositive({
          balance: 12,
          balanceType: BalanceType.Cr,
        }),
      ).toBe(-12);
    });
  });
});
