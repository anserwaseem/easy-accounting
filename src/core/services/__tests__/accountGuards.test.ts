import type { DatabaseDriver } from '../../db/driver';
import { assertActiveAccounts } from '../accountGuards';

const accountRows = [
  { id: 1, name: 'Cash', isActive: 1 },
  { id: 2, name: 'Rwp-Awais', isActive: 0 },
];

const fakeDb = () =>
  ({
    all: jest.fn(async (_sql: string, ids: number[]) =>
      accountRows.filter((row) => ids.includes(row.id)),
    ),
  }) as unknown as DatabaseDriver;

describe('assertActiveAccounts', () => {
  it('accepts only active account ids', async () => {
    await expect(
      assertActiveAccounts(fakeDb(), [1, null, undefined], 'Journal'),
    ).resolves.toBeUndefined();
  });

  it('rejects an inactive account and names it', async () => {
    await expect(
      assertActiveAccounts(fakeDb(), [1, 2], 'Journal'),
    ).rejects.toThrow(/"Rwp-Awais" is inactive/);
  });

  it('can allow an existing document to keep an inactive account', async () => {
    await expect(
      assertActiveAccounts(fakeDb(), [2], 'Invoice', {
        allowInactive: new Set([2]),
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a missing account', async () => {
    await expect(
      assertActiveAccounts(fakeDb(), [99], 'Invoice'),
    ).rejects.toThrow(/#99 not found/);
  });
});
