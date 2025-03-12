import type { Chart, InsertChart, SingularSection, SectionType } from 'types';
import type { Database, Statement } from 'better-sqlite3';
import { capitalize, isEmpty, isNil } from 'lodash';
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

  private stmInsertChartWithDate!: Statement;

  private stmGetChartByNameAndType!: Statement;

  private stmFindCustomHead!: Statement;

  private stmFindParentChart!: Statement;

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

  static getChartName = (
    name: string,
    section: SingularSection,
    sectionType?: SectionType,
  ): string =>
    name ||
    (isNil(sectionType)
      ? capitalize(section)
      : `${capitalize(sectionType)} ${capitalize(section)}`);

  findOrCreateChart(
    chartName: string,
    chartType: string,
    username: string,
    date: string,
    sectionType?: SectionType,
    isCustomHead: boolean = false,
  ): number | bigint {
    // if it's a custom head, use findOrCreateCustomHead
    if (isCustomHead) {
      return this.findOrCreateCustomHead(
        chartName,
        chartType,
        sectionType || null,
        username,
        date,
      );
    }

    // Otherwise, use the existing logic for standard charts
    if (this.chartExists(chartName, chartType, username)) {
      const existingChart = <{ id: number }>(
        this.stmGetChartByNameAndType.get(chartName, chartType, username)
      );
      return existingChart.id;
    }

    return this.stmInsertChartWithDate.run({
      date,
      name: chartName,
      type: chartType,
      username,
    }).lastInsertRowid;
  }

  private chartExists(
    chartName: string,
    chartType: string,
    username: string,
  ): boolean {
    const existingChart = <{ id: number } | undefined>(
      this.stmGetChartByNameAndType.get(chartName, chartType, username)
    );
    return !isNil(existingChart?.id);
  }

  findOrCreateCustomHead(
    customHeadName: string,
    chartType: string,
    sectionType: SectionType,
    username: string,
    date: string,
  ): number | bigint {
    const existingCustomHead = <{ id: number } | undefined>(
      this.stmFindCustomHead.get(customHeadName, username)
    );

    if (existingCustomHead) {
      return existingCustomHead.id;
    }

    // determine the parent chart type based on the section type. for example, if chartType is 'Asset' and sectionType is 'current', we want to find the 'Current Asset' parent chart
    const parentChartName = ChartService.getParentChartName(
      chartType,
      sectionType,
    );

    const parentChart = <{ id: number } | undefined>(
      this.stmFindParentChart.get(parentChartName, chartType, username)
    );

    let parentId: number;

    if (parentChart) {
      parentId = parentChart.id;
    } else {
      // if parent chart doesn't exist, create it first
      const result = this.stmInsertChartWithDate.run({
        date,
        name: parentChartName,
        type: chartType,
        username,
      });
      parentId = Number(result.lastInsertRowid);
    }

    // now create the custom head under the parent. note: the custom head inherits the type from its parent
    const customHeadResult = this.stmInsertChart.run({
      name: customHeadName,
      type: chartType,
      username,
      parentId,
    });

    return customHeadResult.lastInsertRowid;
  }

  private static getParentChartName(
    chartType: string,
    sectionType: SectionType,
  ): string {
    if (isNil(sectionType)) {
      return chartType;
    }
    return `${capitalize(sectionType)} ${chartType}`;
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

    this.stmInsertChartWithDate = this.db.prepare(`
      INSERT INTO chart (date, name, type, userId)
      VALUES (@date, @name, @type, (SELECT id FROM users WHERE username = @username))
    `);

    this.stmGetChartByNameAndType = this.db.prepare(`
      SELECT id FROM chart
      WHERE name = ? AND type = ? AND userId = (SELECT id FROM users WHERE username = ?)
    `);

    this.stmFindCustomHead = this.db.prepare(`
      SELECT c.id
      FROM chart c
      JOIN chart p ON c.parentId = p.id
      WHERE c.name = ? AND c.userId = (SELECT id FROM users WHERE username = ?)
    `);

    this.stmFindParentChart = this.db.prepare(`
      SELECT id
      FROM chart
      WHERE name = ? AND type = ? AND userId = (SELECT id FROM users WHERE username = ?)
    `);
  }
}
