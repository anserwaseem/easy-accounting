import { hashPassword, verifyPassword } from '../../utils/encrypt';
import { store } from '../../store';
import { connect } from '../Database.service';
import { login, logout, register } from '../Auth.service';

jest.mock('../Database.service');
jest.mock('../../store');
jest.mock('../../utils/encrypt');

describe('Auth Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('should return false for non-existent user', () => {
      const mockGet = jest.fn().mockReturnValue(undefined);
      const mockPrepare = jest.fn().mockReturnValue({ get: mockGet });
      (connect as jest.Mock).mockReturnValue({ prepare: mockPrepare });

      const result = login({
        username: 'nonexistent',
        password: 'password123',
      });

      expect(result).toBeFalsy();
      expect(verifyPassword).not.toHaveBeenCalled();
    });

    it('should return false for invalid credentials', () => {
      const mockGet = jest
        .fn()
        .mockReturnValueOnce(undefined) // for invalid username
        .mockReturnValueOnce({
          username: 'testuser',
          password_hash: 'hashed_password',
        });
      const mockPrepare = jest.fn().mockReturnValue({ get: mockGet });
      (connect as jest.Mock).mockReturnValue({ prepare: mockPrepare });
      (verifyPassword as jest.Mock).mockReturnValue(false);

      const result1 = login({
        username: 'nonexistent',
        password: 'password123',
      });
      const result2 = login({
        username: 'testuser',
        password: 'wrong_password',
      });

      expect(result1).toBeFalsy();
      expect(result2).toBeFalsy();
      expect(store.set).not.toHaveBeenCalled();
      expect(verifyPassword).toHaveBeenCalledWith(
        'wrong_password',
        'hashed_password',
      );
    });

    it('should return true for valid credentials', () => {
      const mockGet = jest.fn().mockReturnValue({
        username: 'testuser',
        password_hash: 'hashed_password',
      });
      const mockPrepare = jest.fn().mockReturnValue({ get: mockGet });
      (connect as jest.Mock).mockReturnValue({ prepare: mockPrepare });
      (verifyPassword as jest.Mock).mockReturnValue(true);

      const result = login({ username: 'testuser', password: 'password123' });

      expect(result).toBe(true);
      expect(store.set).toHaveBeenCalledWith('username', 'testuser');
      expect(verifyPassword).toHaveBeenCalledWith(
        'password123',
        'hashed_password',
      );
    });
  });

  describe('register', () => {
    it('should return false for short username or password', () => {
      const result1 = register({ username: 'abc', password: 'password123' });
      const result2 = register({ username: 'validuser', password: 'abc' });

      expect(result1).toBeFalsy();
      expect(result2).toBeFalsy();
      expect(hashPassword).not.toHaveBeenCalled();
    });

    it('should return false for existing username', () => {
      const mockGet = jest.fn().mockReturnValue({ username: 'existinguser' });
      const mockPrepare = jest.fn().mockReturnValue({ get: mockGet });
      (connect as jest.Mock).mockReturnValue({ prepare: mockPrepare });

      const result = register({
        username: 'existinguser',
        password: 'password123',
      });

      expect(result).toBeFalsy();
      expect(hashPassword).not.toHaveBeenCalled();
    });

    it('should return true for successful registration', () => {
      const mockGet = jest.fn().mockReturnValue(undefined);
      const mockRun = jest.fn();
      const mockPrepare = jest
        .fn()
        .mockReturnValue({ get: mockGet, run: mockRun });
      (connect as jest.Mock).mockReturnValue({ prepare: mockPrepare });
      (hashPassword as jest.Mock).mockReturnValue('hashed_password');

      const result = register({ username: 'newuser', password: 'password123' });

      expect(result).toBe(true);
      expect(hashPassword).toHaveBeenCalledWith('password123');
      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'newuser',
          password_hash: 'hashed_password',
        }),
      );
    });
  });

  describe('logout', () => {
    it('should call store.delete with username', () => {
      logout();
      expect(store.delete).toHaveBeenCalledWith('username');
    });
  });
});
