import type { DbUser, UserCredentials } from 'types';
import type { Database } from 'better-sqlite3';
import { store } from '../store';
import { hashPassword, verifyPassword } from '../utils/encrypt';
import { DatabaseService } from './Database.service';
import { ChartService } from './Chart.service';
import { INITIAL_CHARTS } from '../utils/constants';
import { logErrors } from '../errorLogger';

@logErrors
export class AuthService {
  private db: Database;

  private chartService: ChartService;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.chartService = new ChartService();
  }

  private getUser(username: string): DbUser | undefined {
    const stm = this.db.prepare(
      'SELECT * FROM users where username = @username',
    );
    return stm.get({ username }) as DbUser | undefined;
  }

  private insertUser(user: DbUser): void {
    const stm = this.db.prepare(
      `INSERT INTO users (username, password_hash, status)
       VALUES (@username, @password_hash, @status)`,
    );
    stm.run(user);
  }

  public login(user: UserCredentials): boolean {
    const dbUser = this.getUser(user.username);
    if (!dbUser) {
      return false;
    }

    const isValid = verifyPassword(user.password, dbUser.password_hash);

    if (isValid) {
      store.set('username', user.username);
    }

    return isValid;
  }

  public register(user: UserCredentials): boolean {
    try {
      if (user.username.length < 4 || user.password.length < 4) {
        return false;
      }

      const userExists = this.getUser(user.username);
      if (userExists) {
        return false;
      }

      const passwordHash = hashPassword(user.password);

      const registerUser = {
        username: user.username,
        password_hash: passwordHash,
        status: 1,
      };

      this.insertUser(registerUser);

      // Correctly use the ChartService to insert initial charts
      this.chartService.insertCharts(user.username, INITIAL_CHARTS);

      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  public static logout(): void {
    store.delete('username');
  }
}
