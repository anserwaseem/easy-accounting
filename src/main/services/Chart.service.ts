import type { Chart } from 'types';
import type { Database } from 'better-sqlite3';
import { isEmpty } from 'lodash';
import { store } from '../store';
import { DatabaseService } from './Database.service';
import { logErrors } from '../errorLogger';

@logErrors
export class ChartService {
  private db: Database;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
  }

  public getCharts(): Chart[] {
    const stm = this.db.prepare(
      ` SELECT *
        FROM chart
        WHERE userId = (
          SELECT id
          FROM users
          WHERE username = @username
        )`,
    );

    return stm.all({
      username: store.get('username'),
    }) as Chart[];
  }

  public insertCharts(username: string, charts: Omit<Chart, 'id'>[]): boolean {
    if (isEmpty(username) || charts.length === 0) {
      return false;
    }

    const placeholders = charts
      .map(() => '(?, ?, ?, (SELECT id FROM users WHERE username = ?))')
      .join(', ');
    const sql = `INSERT INTO chart (date, name, type, userId) VALUES ${placeholders}`;

    const stmChart = this.db.prepare(sql);

    const values = charts.flatMap((chart) => [
      chart.date,
      chart.name,
      chart.type,
      username,
    ]);

    return Boolean(stmChart.run(values).changes);
  }
}
