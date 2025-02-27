import type { Chart, InsertChart } from 'types';
import type { Database, Statement } from 'better-sqlite3';
import { isEmpty } from 'lodash';
import { store } from '../store';
import { DatabaseService } from './Database.service';
import { logErrors } from '../errorLogger';

@logErrors
export class ChartService {
  private db: Database;

  private stmGetCharts!: Statement;

  private stmGetUserId!: Statement;

  private stmInsertChart!: Statement;

  private stmGetCustomHeads!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.initPreparedStatements();
  }

  getCharts(): Chart[] {
    const username = store.get('username');
    const results = this.stmGetCharts.all({ username }) as Chart[];
    return results;
  }

  /** Used to insert normal heads e.g. "Current Asset". Not exposed to the UI */
  insertCharts(username: string, charts: Omit<Chart, 'id'>[]): boolean {
    if (isEmpty(username) || charts.length === 0) {
      return false;
    }

    const userId = <{ id: number } | undefined>this.stmGetUserId.get(username);
    if (!userId) {
      return false;
    }

    const placeholders = charts.map(() => '(?, ?, ?, ?)').join(', ');
    const sql = `INSERT INTO chart (date, name, type, userId) VALUES ${placeholders}`;

    const stmInsertCharts = this.db.prepare(sql);

    const values = charts.flatMap((chart) => [
      chart.date,
      chart.name,
      chart.type,
      userId.id,
    ]);

    const result = stmInsertCharts.run(values);
    return Boolean(result.changes);
  }

  getCustomHeads(): Chart[] {
    const username = store.get('username');
    const results = this.stmGetCustomHeads.all({ username }) as Chart[];
    return results;
  }

  insertCustomHead(chart: InsertChart) {
    const username = store.get('username');
    return this.stmInsertChart.run({
      ...chart,
      username,
    });
  }

  private initPreparedStatements() {
    this.stmGetCharts = this.db.prepare(`
      SELECT *
      FROM chart
      WHERE userId = (
        SELECT id FROM users WHERE username = @username
      )
    `);

    this.stmGetUserId = this.db.prepare(`
      SELECT id FROM users WHERE username = ?
    `);

    this.stmGetCustomHeads = this.db.prepare(`
      SELECT c.*, p.name as parentName, p.type as parentType
      FROM chart c
      JOIN chart p ON c.parentId = p.id
      WHERE c.userId = (
        SELECT id FROM users WHERE username = @username
      )
    `);

    this.stmInsertChart = this.db.prepare(`
      INSERT INTO chart (name, type, userId, parentId)
      VALUES (
        @name,
        @type,
        (SELECT id FROM users WHERE username = @username),
        @parentId
      )
    `);
  }
}
