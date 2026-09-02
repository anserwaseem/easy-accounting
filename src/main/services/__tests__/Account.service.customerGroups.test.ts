/**
 * Customer-group methods on AccountService ("025 migration"): reading groups
 * with their members, assigning/clearing an account's group, and creating
 * groups. Runs against the real schema + full migration chain so the tests
 * see exactly the table and column a released build has.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { MigrationRunner } from '../../migrations';
import type { InsertAccount, UserCredentials } from '../../../types';
import { AccountService, AuthService, DatabaseService } from '..';

const TEST_DB_USER: UserCredentials = {
  username: 'testuser',
  password: 'testpassword',
};

jest.mock('electron-log', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  verbose: jest.fn(),
  debug: jest.fn(),
  silly: jest.fn(),
  transports: {
    file: { getFile: jest.fn() },
    console: { level: 'debug' },
  },
}));

jest.mock('../../store', () => ({
  store: {
    get: jest.fn((key) => {
      if (key === 'username') return 'testuser';
      return jest.fn();
    }),
    set: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

const defaultAccountFields = {
  address: undefined,
  phone1: undefined,
  phone2: undefined,
  goodsName: undefined,
  isActive: true,
  discountProfileId: null,
};

describe('AccountService customer groups', () => {
  let accountService: AccountService;
  let authService: AuthService;
  let db: Database.Database;

  const insertParty = (name: string, code?: string): number => {
    const account: InsertAccount = {
      name,
      headName: 'Current Asset',
      code,
      ...defaultAccountFields,
    };
    expect(accountService.insertAccount(account)).toBe(true);
    return accountService.getAccountByName(name)!.id;
  };

  beforeEach(async () => {
    db = new Database(':memory:');
    jest.spyOn(DatabaseService, 'getInstance').mockImplementation(
      () =>
        ({
          getDatabase: () => db,
        }) as unknown as DatabaseService,
    );

    const schemaPath = path.join(__dirname, '../../../sql/schema.sql');
    db.exec(fs.readFileSync(schemaPath, 'utf-8'));

    const migrationRunner = new MigrationRunner();
    await migrationRunner.waitForMigrations();

    authService = new AuthService();
    authService.register(TEST_DB_USER);
    accountService = new AccountService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    db.close();
  });

  it('createCustomerGroup returns the new group and rejects blank names', () => {
    const group = accountService.createCustomerGroup('  Kitab Ghar RWP  ');
    expect(group).toEqual({ id: expect.any(Number), name: 'Kitab Ghar RWP' });

    expect(accountService.createCustomerGroup('')).toBeUndefined();
    expect(accountService.createCustomerGroup('   ')).toBeUndefined();
  });

  it('setAccountCustomerGroup assigns, reassigns and clears', () => {
    const group = accountService.createCustomerGroup('Group A')!;
    const accountId = insertParty('Shop One', 'RWP-ONE');

    expect(accountService.setAccountCustomerGroup(accountId, group.id)).toBe(
      true,
    );
    expect(
      accountService.getAccounts().find((a) => a.id === accountId)
        ?.customerGroupId,
    ).toBe(group.id);

    expect(accountService.setAccountCustomerGroup(accountId, null)).toBe(true);
    expect(
      accountService.getAccounts().find((a) => a.id === accountId)
        ?.customerGroupId,
    ).toBeNull();
  });

  it('setAccountCustomerGroup rejects invalid ids without touching data', () => {
    const group = accountService.createCustomerGroup('Group A')!;
    const accountId = insertParty('Shop One', 'RWP-ONE');
    accountService.setAccountCustomerGroup(accountId, group.id);

    expect(accountService.setAccountCustomerGroup(0, group.id)).toBe(false);
    expect(accountService.setAccountCustomerGroup(-1, group.id)).toBe(false);
    expect(accountService.setAccountCustomerGroup(accountId, 0)).toBe(false);
    expect(accountService.setAccountCustomerGroup(accountId, 1.5)).toBe(false);
    expect(
      accountService.getAccounts().find((a) => a.id === accountId)
        ?.customerGroupId,
    ).toBe(group.id);
  });

  it('getCustomerGroups lists every group with its member ids/names/codes', () => {
    const groupA = accountService.createCustomerGroup('Alpha')!;
    const groupB = accountService.createCustomerGroup('Beta')!;
    const a1 = insertParty('Alpha Base', 'RWP-AL');
    const a2 = insertParty('Alpha Base-T', 'RWP-AL-T');
    const b1 = insertParty('Beta Base', 'QUE-BE');
    insertParty('Ungrouped', 'LHR-UN');
    accountService.setAccountCustomerGroup(a1, groupA.id);
    accountService.setAccountCustomerGroup(a2, groupA.id);
    accountService.setAccountCustomerGroup(b1, groupB.id);

    const groups = accountService.getCustomerGroups();
    expect(groups).toHaveLength(2);

    const alpha = groups.find((g) => g.id === groupA.id)!;
    expect(alpha.name).toBe('Alpha');
    expect(alpha.accounts.map((a) => a.id).sort((x, y) => x - y)).toEqual(
      [a1, a2].sort((x, y) => x - y),
    );
    expect(alpha.accounts.map((a) => a.name).sort()).toEqual([
      'Alpha Base',
      'Alpha Base-T',
    ]);

    const beta = groups.find((g) => g.id === groupB.id)!;
    expect(beta.accounts.map((a) => a.id)).toEqual([b1]);
  });

  it('an empty group still lists, with no members', () => {
    const group = accountService.createCustomerGroup('Empty')!;
    const groups = accountService.getCustomerGroups();
    expect(groups.find((g) => g.id === group.id)?.accounts).toEqual([]);
  });

  it('getAccountsInGroup returns full account rows for members only', () => {
    const group = accountService.createCustomerGroup('Alpha')!;
    const a1 = insertParty('Alpha Base', 'RWP-AL');
    const a2 = insertParty('Alpha Base-T', 'RWP-AL-T');
    insertParty('Other Shop', 'QUE-OT');
    accountService.setAccountCustomerGroup(a1, group.id);
    accountService.setAccountCustomerGroup(a2, group.id);

    const members = accountService.getAccountsInGroup(group.id);
    expect(members.map((a) => a.id).sort((x, y) => x - y)).toEqual(
      [a1, a2].sort((x, y) => x - y),
    );
    // same shape the account list uses everywhere else
    expect(members[0]).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        name: expect.any(String),
        headName: 'Current Asset',
        customerGroupId: group.id,
        isActive: true,
      }),
    );
  });

  it('getAccountsInGroup rejects invalid group ids', () => {
    expect(accountService.getAccountsInGroup(0)).toEqual([]);
    expect(accountService.getAccountsInGroup(-3)).toEqual([]);
    expect(accountService.getAccountsInGroup(2.5)).toEqual([]);
    expect(accountService.getAccountsInGroup(999999)).toEqual([]);
  });

  it('getAccounts row shape now carries customerGroupId', () => {
    const accountId = insertParty('Shop One', 'RWP-ONE');
    const row = accountService.getAccounts().find((a) => a.id === accountId)!;
    expect(row).toHaveProperty('customerGroupId', null);

    const byIds = accountService.getAccountsByIds([accountId]);
    expect(byIds[0]).toHaveProperty('customerGroupId', null);
  });
});
