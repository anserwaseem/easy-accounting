import { BalanceType } from 'types';
import {
  getPartyFamilyAccountIds,
  ledgerBalanceToSignedDrPositive,
  sumLedgerBalances,
} from '../partyFamilyBalance';

describe('partyFamilyBalance', () => {
  const kar = {
    id: 10,
    name: 'MAKTABA USMANIA',
    code: 'KAR-USMANIA',
    chartId: 14,
  };
  const karT = {
    id: 11,
    name: 'MAKTABA USMANIA',
    code: 'KAR-USMANIA-T',
    chartId: 14,
  };
  const rwp = {
    id: 20,
    name: 'MAKTABA USMANIA',
    code: 'RWP-USMANIA',
    chartId: 10,
  };
  const rwpT = {
    id: 21,
    name: 'MAKTABA USMANIA-T',
    code: 'RWP-USMANIA-T',
    chartId: 10,
  };
  const accounts = [kar, karT, rwp, rwpT];
  const itemTypes = ['T', 'TT'];

  describe('getPartyFamilyAccountIds', () => {
    it('returns base + typed variants matched by code when base is selected', () => {
      expect(
        getPartyFamilyAccountIds(10, accounts, itemTypes).sort((a, b) => a - b),
      ).toEqual([10, 11]);
    });

    it('returns same family when a typed variant is selected', () => {
      expect(
        getPartyFamilyAccountIds(11, accounts, itemTypes).sort((a, b) => a - b),
      ).toEqual([10, 11]);
    });

    it('does not pull other shops that share the same display name', () => {
      // regression: name-based matching wrongly added RWP-USMANIA-T into KAR family
      expect(
        getPartyFamilyAccountIds(10, accounts, itemTypes).sort((a, b) => a - b),
      ).toEqual([10, 11]);
      expect(
        getPartyFamilyAccountIds(20, accounts, itemTypes).sort((a, b) => a - b),
      ).toEqual([20, 21]);
    });

    it('returns only itself for an untyped party with no code siblings', () => {
      const solo = { id: 30, name: 'Solo', code: 'SOLO', chartId: 1 };
      expect(
        getPartyFamilyAccountIds(30, [...accounts, solo], itemTypes),
      ).toEqual([30]);
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
