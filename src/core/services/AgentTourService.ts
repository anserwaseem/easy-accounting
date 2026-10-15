import { trim } from 'lodash';
import type {
  AgentTour,
  AgentTourInput,
  SuggestedAgentTour,
} from '../../types';
import type { DatabaseDriver } from '../db/driver';
import type { SessionContext } from '../ports';
import { logErrors } from '../errorLogger';
import { localDaySql, RECEIPT_ACCOUNTS_CTE } from '../utils/receiptAccounts';
import {
  BULK_RECEIPT_MIN_CREDIT_LINES,
  suggestAgentTours,
  toursOverlap,
  type BulkReceiptDay,
} from '../utils/suggestAgentTours';

const SQL = {
  ownedCustomHead: `
      SELECT c.id
      FROM chart c
      WHERE c.id = @chartId
        AND c.parentId IS NOT NULL
        AND c.userId = (SELECT id FROM users WHERE username = @username)
    `,
  listByChart: `
      SELECT id, chartId, name, startDate, endDate, notes, createdAt, updatedAt
      FROM agent_tours
      WHERE chartId = @chartId
      ORDER BY startDate DESC, id DESC
    `,
  listByChartIds: `
      SELECT id, chartId, name, startDate, endDate, notes, createdAt, updatedAt
      FROM agent_tours
      WHERE chartId IN (SELECT CAST(j.value AS INTEGER) FROM json_each(@chartIdsJson) AS j)
      ORDER BY chartId, startDate, id
    `,
  getById: `
      SELECT id, chartId, name, startDate, endDate, notes, createdAt, updatedAt
      FROM agent_tours
      WHERE id = @id
    `,
  insert: `
      INSERT INTO agent_tours (chartId, name, startDate, endDate, notes)
      VALUES (@chartId, @name, @startDate, @endDate, @notes)
    `,
  update: `
      UPDATE agent_tours
      SET name = @name, startDate = @startDate, endDate = @endDate, notes = @notes
      WHERE id = @id
    `,
  delete: `
      DELETE FROM agent_tours WHERE id = @id
    `,
  // manual journals crediting many accounts of one head against a receipt
  // account: an agent's tour settlement. balance transfers stop qualifying
  // once their account is set to never count as a collection.
  bulkReceiptDays: `
      WITH ${RECEIPT_ACCOUNTS_CTE},
      bulk AS (
        SELECT je.journalId
        FROM journal_entry je
        JOIN journal j ON j.id = je.journalId AND j.invoiceId IS NULL
        JOIN account a ON a.id = je.accountId AND a.chartId = @chartId
        WHERE je.creditAmount > 0
          AND EXISTS (
            SELECT 1 FROM journal_entry d
            WHERE d.journalId = je.journalId
              AND d.debitAmount > 0
              AND d.accountId IN (SELECT id FROM receipt_accounts)
          )
        GROUP BY je.journalId
        HAVING COUNT(DISTINCT je.accountId) >= @minLines
      )
      SELECT
        ${localDaySql('j.date')} AS day,
        MIN(j.id) AS journalId,
        COUNT(DISTINCT je.accountId) AS creditLines
      FROM bulk
      JOIN journal j ON j.id = bulk.journalId
      JOIN journal_entry je ON je.journalId = j.id AND je.creditAmount > 0
      JOIN account a ON a.id = je.accountId AND a.chartId = @chartId
      GROUP BY day
      ORDER BY day
    `,
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** trimmed, validated copy. throws on anything a tour row must not hold */
const normalizeInput = (input: AgentTourInput): AgentTourInput => {
  const name = trim(input.name ?? '');
  if (!name) throw new Error('Tour name is required');
  if (!ISO_DAY.test(input.startDate ?? '')) {
    throw new Error('Tour start date must be yyyy-MM-dd');
  }
  const endDate = input.endDate ? input.endDate : null;
  if (endDate !== null && !ISO_DAY.test(endDate)) {
    throw new Error('Tour end date must be yyyy-MM-dd');
  }
  if (endDate !== null && endDate < input.startDate) {
    throw new Error('Tour cannot end before it starts');
  }
  return {
    chartId: Number(input.chartId),
    name,
    startDate: input.startDate,
    endDate,
    notes: trim(input.notes ?? '') || null,
  };
};

/**
 * agent tours: dated trips per custom head, kept as history.
 * tours of one head never overlap, so a receipt date maps to at most one tour.
 * a running tour (no end date) overlaps everything after it, which keeps it the latest.
 */
@logErrors
export class AgentTourService {
  private db: DatabaseDriver;

  private session: SessionContext;

  constructor(deps: { db: DatabaseDriver; session: SessionContext }) {
    this.db = deps.db;
    this.session = deps.session;
  }

  async getAgentTours(chartId: number): Promise<AgentTour[]> {
    return this.db.all<AgentTour>(SQL.listByChart, { chartId });
  }

  async getAgentToursForCharts(chartIds: number[]): Promise<AgentTour[]> {
    if (chartIds.length === 0) return [];
    return this.db.all<AgentTour>(SQL.listByChartIds, {
      chartIdsJson: JSON.stringify(chartIds),
    });
  }

  async insertAgentTour(input: AgentTourInput): Promise<number> {
    const tour = normalizeInput(input);
    await this.assertWritable(tour, null);
    const result = await this.db.run(SQL.insert, { ...tour });
    return Number(result.lastInsertRowid);
  }

  /** all or nothing, so a reviewed batch of suggestions never half-saves */
  async insertAgentTours(inputs: AgentTourInput[]): Promise<number> {
    const tours = inputs.map(normalizeInput);
    tours.forEach((tour, index) => {
      const clash = tours.find(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.chartId === tour.chartId &&
          toursOverlap(other, tour),
      );
      if (clash) {
        throw new Error(`"${tour.name}" overlaps "${clash.name}"`);
      }
    });
    return this.db.transaction(async () => {
      for (const tour of tours) {
        // eslint-disable-next-line no-await-in-loop
        await this.assertWritable(tour, null);
        // eslint-disable-next-line no-await-in-loop
        await this.db.run(SQL.insert, { ...tour });
      }
      return tours.length;
    });
  }

  async updateAgentTour(id: number, input: AgentTourInput): Promise<boolean> {
    const current = await this.db.get<AgentTour>(SQL.getById, { id });
    if (!current) throw new Error('Tour not found');
    const tour = normalizeInput({ ...input, chartId: current.chartId });
    await this.assertWritable(tour, id);
    const result = await this.db.run(SQL.update, { ...tour, id });
    return result.changes > 0;
  }

  async deleteAgentTour(id: number): Promise<boolean> {
    const result = await this.db.run(SQL.delete, { id });
    return result.changes > 0;
  }

  /** proposals only. nothing is written until the user saves them */
  async suggestAgentTours(chartId: number): Promise<SuggestedAgentTour[]> {
    const [bulkDays, existing] = await Promise.all([
      this.db.all<BulkReceiptDay>(SQL.bulkReceiptDays, {
        chartId,
        minLines: BULK_RECEIPT_MIN_CREDIT_LINES,
      }),
      this.getAgentTours(chartId),
    ]);
    return suggestAgentTours(chartId, bulkDays, existing);
  }

  private async assertWritable(
    tour: AgentTourInput,
    selfId: number | null,
  ): Promise<void> {
    const username = this.session.getUsername();
    const head = await this.db.get<{ id: number }>(SQL.ownedCustomHead, {
      chartId: tour.chartId,
      username,
    });
    if (!head) throw new Error('Tours belong to a custom head (agent)');

    const siblings = await this.getAgentTours(tour.chartId);
    const clash = siblings.find(
      (other) => other.id !== selfId && toursOverlap(other, tour),
    );
    if (clash) {
      throw new Error(
        `Overlaps "${clash.name}" (${clash.startDate} to ${
          clash.endDate ?? 'running'
        })`,
      );
    }
  }
}
