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
    get: jest.fn((key: string) => {
      if (key === 'username') return TEST_DB_USER.username;
      return undefined;
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

describe('AccountService', () => {
  let accountService: AccountService;
  let authService: AuthService;
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    jest.spyOn(DatabaseService, 'getInstance').mockImplementation(
      () =>
        ({
          getDatabase: () => db,
        }) as unknown as DatabaseService,
    );

    const schemaPath = path.join(__dirname, '../../../sql/schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schemaSql);

    const migrationRunner = new MigrationRunner();
    await migrationRunner.waitForMigrations();

    accountService = new AccountService();
    authService = new AuthService();
    authService.register(TEST_DB_USER);
  });

  afterEach(() => {
    db.close();
  });

  it('inserts account with discountProfileId and returns it in getAccounts', () => {
    const profileId = db
      .prepare('INSERT INTO discount_profiles (name, isActive) VALUES (?, 1)')
      .run('Wholesale 10%').lastInsertRowid as number;

    const account: InsertAccount = {
      name: 'Customer A',
      headName: 'Current Asset',
      code: 'CUST-001',
      isActive: true,
      discountProfileId: profileId,
    };

    const inserted = accountService.insertAccount(account);
    expect(inserted).toBe(true);

    const accounts = accountService.getAccounts();
    const created = accounts.find((a) => a.name === 'Customer A');
    expect(created).toBeDefined();
    expect(created?.discountProfileId).toBe(profileId);
    expect(created?.discountProfileName).toBe('Wholesale 10%');
  });

  it('inserts account with null discountProfileId when none is provided', () => {
    const account: InsertAccount = {
      name: 'Customer B',
      headName: 'Current Asset',
      code: 'CUST-002',
      isActive: true,
    };

    const inserted = accountService.insertAccount(account);
    expect(inserted).toBe(true);

    const accounts = accountService.getAccounts();
    const created = accounts.find((a) => a.name === 'Customer B');
    expect(created).toBeDefined();
    expect(created?.discountProfileId).toBeNull();
    expect(created?.discountProfileName).toBeNull();
  });
});
