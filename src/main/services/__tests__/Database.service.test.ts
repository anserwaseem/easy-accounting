import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { DatabaseService } from '../Database.service';

jest.mock('better-sqlite3');
jest.mock('fs');

describe('Database Service', () => {
  let mockDatabase: jest.Mocked<Database.Database>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDatabase = {
      verbose: jest.fn(),
    } as unknown as jest.Mocked<Database.Database>;
    (Database as unknown as jest.Mock).mockReturnValue(mockDatabase);

    // Reset the singleton instance before each test
    (DatabaseService as any).instance = undefined;
    (DatabaseService as any)._path = undefined;
    (process as any).resourcesPath = '/mock/resources/path';
  });

  it('should use the correct database path in development environment', () => {
    process.env.NODE_ENV = 'development';

    DatabaseService.getInstance();

    expect(Database).toHaveBeenCalledWith(
      expect.stringContaining(path.join('release', 'app', 'database.db')),
      expect.any(Object),
    );
  });

  it('should use the correct database path in production environment', () => {
    process.env.NODE_ENV = 'production';
    const mockUserDataPath = '/mock/user/data/path';
    (app.getPath as jest.Mock).mockReturnValue(mockUserDataPath);
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.copyFileSync as jest.Mock).mockImplementation();

    DatabaseService.getInstance();

    expect(Database).toHaveBeenCalledWith(
      path.join(mockUserDataPath, 'database.db'),
      expect.any(Object),
    );
  });

  it("should copy the database file in production if it doesn't exist", () => {
    process.env.NODE_ENV = 'production';
    const mockUserDataPath = '/mock/user/data/path';
    (app.getPath as jest.Mock).mockReturnValue(mockUserDataPath);
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    DatabaseService.getInstance();

    expect(fs.copyFileSync).toHaveBeenCalled();
  });

  it('should not copy the database file in production if it already exists', () => {
    process.env.NODE_ENV = 'production';
    const mockUserDataPath = '/mock/user/data/path';
    (app.getPath as jest.Mock).mockReturnValue(mockUserDataPath);
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    DatabaseService.getInstance();

    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });

  it('should return the same instance on multiple calls', () => {
    const instance1 = DatabaseService.getInstance();
    const instance2 = DatabaseService.getInstance();

    expect(instance1).toBe(instance2);
  });
});
