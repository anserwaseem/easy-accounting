import type { DbUser, UserCredentials } from 'types';
import type { Database, Statement } from 'better-sqlite3';
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

  private stmGetUser!: Statement;

  private stmInsertUser!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.chartService = new ChartService();
    this.initPreparedStatements();
  }

  login(user: UserCredentials): boolean {
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

  register(user: UserCredentials): boolean {
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

      this.chartService.insertCharts(user.username, INITIAL_CHARTS);

      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  static logout(): void {
    store.delete('username');
  }

  private getUser(username: string): DbUser | undefined {
    const result = this.stmGetUser.get({ username }) as DbUser | undefined;
    return result;
  }

  private insertUser(user: DbUser): void {
    this.stmInsertUser.run(user);
  }

  private initPreparedStatements() {
    this.stmGetUser = this.db.prepare(
      'SELECT * FROM users WHERE username = @username',
    );
    this.stmInsertUser = this.db.prepare(
      `INSERT INTO users (username, password_hash, status)
       VALUES (@username, @password_hash, @status)`,
    );
  }
}
