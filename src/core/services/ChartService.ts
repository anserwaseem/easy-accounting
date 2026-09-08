import type { Chart, InsertChart, SingularSection, SectionType } from 'types';
import { capitalize, isEmpty, isNil } from 'lodash';
import type { DatabaseDriver } from '../db/driver';
import type { SessionContext } from '../ports';
import { logErrors } from '../errorLogger';

const SQL = {
  getCharts: `
      SELECT *
      FROM chart
      WHERE userId = (
        SELECT id FROM users WHERE username = @username
      )
    `,
  getUserId: `
      SELECT id FROM users WHERE username = ?
    `,
  getCustomHeads: `
      SELECT c.*, p.name as parentName, p.type as parentType
      FROM chart c
      JOIN chart p ON c.parentId = p.id
      WHERE c.userId = (
        SELECT id FROM users WHERE username = @username
      )
    `,
  insertChart: `
      INSERT INTO chart (name, type, userId, parentId)
      VALUES (
        @name,
        @type,
        (SELECT id FROM users WHERE username = @username),
        @parentId
      )
    `,
  insertChartWithDate: `
      INSERT INTO chart (date, name, type, userId)
      VALUES (@date, @name, @type, (SELECT id FROM users WHERE username = @username))
    `,
  getChartByNameAndType: `
      SELECT id FROM chart
      WHERE name = ? AND type = ? AND userId = (SELECT id FROM users WHERE username = ?)
    `,
  findCustomHead: `
      SELECT c.id
      FROM chart c
      JOIN chart p ON c.parentId = p.id
      WHERE c.name = ? AND c.userId = (SELECT id FROM users WHERE username = ?)
    `,
  findParentChart: `
      SELECT id
      FROM chart
      WHERE name = ? AND type = ? AND userId = (SELECT id FROM users WHERE username = ?)
    `,
};

/**
 * Platform-free port of src/main/services/Chart.service.ts — identical SQL
 * and behavior, async against the DatabaseDriver, session injected.
 */
@logErrors
export class ChartService {
  private db: DatabaseDriver;

  private session: SessionContext;

  constructor(deps: { db: DatabaseDriver; session: SessionContext }) {
    this.db = deps.db;
    this.session = deps.session;
  }

  async getCharts(): Promise<Chart[]> {
    const username = this.session.getUsername();
    return this.db.all<Chart>(SQL.getCharts, { username });
  }

  /** Used to insert normal heads e.g. "Current Asset". Not exposed to the UI */
  async insertCharts(
    username: string,
    charts: Omit<Chart, 'id'>[],
  ): Promise<boolean> {
    if (isEmpty(username) || charts.length === 0) {
      return false;
    }

    const userId = await this.db.get<{ id: number }>(SQL.getUserId, [username]);
    if (!userId) {
      return false;
    }

    const placeholders = charts.map(() => '(?, ?, ?, ?)').join(', ');
    const sql = `INSERT INTO chart (date, name, type, userId) VALUES ${placeholders}`;

    const values = charts.flatMap((chart) => [
      chart.date,
      chart.name,
      chart.type,
      userId.id,
    ]);

    const result = await this.db.run(sql, values);
    return Boolean(result.changes);
  }

  async getCustomHeads(): Promise<Chart[]> {
    const username = this.session.getUsername();
    return this.db.all<Chart>(SQL.getCustomHeads, { username });
  }

  async insertCustomHead(chart: InsertChart) {
    const username = this.session.getUsername();
    return this.db.run(SQL.insertChart, {
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

  async findOrCreateChart(
    chartName: string,
    chartType: string,
    username: string,
    date: string,
    sectionType?: SectionType,
    isCustomHead: boolean = false,
  ): Promise<number | bigint> {
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
    const existingChart = await this.db.get<{ id: number }>(
      SQL.getChartByNameAndType,
      [chartName, chartType, username],
    );
    if (!isNil(existingChart?.id)) {
      return existingChart!.id;
    }

    const result = await this.db.run(SQL.insertChartWithDate, {
      date,
      name: chartName,
      type: chartType,
      username,
    });
    return result.lastInsertRowid;
  }

  async findOrCreateCustomHead(
    customHeadName: string,
    chartType: string,
    sectionType: SectionType,
    username: string,
    date: string,
  ): Promise<number | bigint> {
    const existingCustomHead = await this.db.get<{ id: number }>(
      SQL.findCustomHead,
      [customHeadName, username],
    );

    if (existingCustomHead) {
      return existingCustomHead.id;
    }

    // determine the parent chart type based on the section type. for example, if chartType is 'Asset' and sectionType is 'current', we want to find the 'Current Asset' parent chart
    const parentHeadName = ChartService.getParentChartName(
      chartType,
      sectionType,
    );

    const parentChart = await this.db.get<{ id: number }>(SQL.findParentChart, [
      parentHeadName,
      chartType,
      username,
    ]);

    let parentId: number;

    if (parentChart) {
      parentId = parentChart.id;
    } else {
      // if parent chart doesn't exist, create it first
      const result = await this.db.run(SQL.insertChartWithDate, {
        date,
        name: parentHeadName,
        type: chartType,
        username,
      });
      parentId = Number(result.lastInsertRowid);
    }

    // now create the custom head under the parent. note: the custom head inherits the type from its parent
    const customHeadResult = await this.db.run(SQL.insertChart, {
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
}
