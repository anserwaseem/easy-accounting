import type {
  AgentCommissionConfig,
  AgentCommissionReport,
  AgentCommissionSettlement,
  AgentCommissionTypeRate,
  CommissionAdjustment,
  CommissionReportBucket,
  CommissionReportItemLine,
  PostCommissionSettlementPayload,
} from '../../types';
import type { DatabaseDriver } from '../db/driver';
import { logErrors } from '../errorLogger';
import type { JournalService } from './JournalService';

const SQL = {
  getAgentHead: `
    SELECT id, name, nameUrdu
    FROM chart
    WHERE id = @chartId AND parentId IS NOT NULL
    LIMIT 1
  `,
  getCommissionConfig: `
    SELECT id, chartId, payableAccountId, expenseAccountId, ratesJson, overridesJson, createdAt, updatedAt
    FROM agent_commissions
    WHERE chartId = @chartId
    LIMIT 1
  `,
  upsertCommissionConfig: `
    INSERT INTO agent_commissions (chartId, payableAccountId, expenseAccountId, ratesJson, overridesJson)
    VALUES (@chartId, @payableAccountId, @expenseAccountId, @ratesJson, @overridesJson)
    ON CONFLICT(chartId) DO UPDATE SET
      payableAccountId = excluded.payableAccountId,
      expenseAccountId = excluded.expenseAccountId,
      ratesJson = excluded.ratesJson,
      overridesJson = excluded.overridesJson
  `,
  getSaleLinesForAgent: `
    SELECT
      inv.id AS invoiceId,
      inv.invoiceNumber,
      inv.date AS invoiceDate,
      a.id AS accountId,
      a.name AS accountName,
      a.code AS accountCode,
      i.id AS inventoryId,
      i.name AS itemName,
      i.description AS itemDescription,
      i.itemTypeId,
      COALESCE(it.name, '') AS itemTypeName,
      ii.quantity,
      ii.price,
      COALESCE(ii.discount, 0) AS discount,
      ii.netPrice
    FROM invoice_items ii
    JOIN invoices inv ON inv.id = ii.invoiceId
    JOIN account a ON a.id = COALESCE(ii.accountId, inv.accountId)
    JOIN inventory i ON i.id = ii.inventoryId
    LEFT JOIN item_types it ON it.id = i.itemTypeId
    WHERE a.chartId = @chartId
      AND inv.invoiceType = 'Sale'
      AND COALESCE(inv.isReturned, 0) = 0
      AND COALESCE(inv.isQuotation, 0) = 0
      AND date(inv.date) >= date(@startDate)
      AND date(inv.date) <= date(@endDate)
    ORDER BY inv.date ASC, inv.invoiceNumber ASC, ii.id ASC
  `,
  getSettlement: `
    SELECT id, chartId, startDate, endDate, journalId, grossCommission, adjustmentsJson, netCommission, snapshotJson, createdAt, updatedAt
    FROM agent_commission_settlements
    WHERE chartId = @chartId AND startDate = @startDate AND endDate = @endDate
    LIMIT 1
  `,
  getSettlementById: `
    SELECT id, chartId, startDate, endDate, journalId, grossCommission, adjustmentsJson, netCommission, snapshotJson, createdAt, updatedAt
    FROM agent_commission_settlements
    WHERE id = @id
    LIMIT 1
  `,
  insertSettlement: `
    INSERT INTO agent_commission_settlements (
      chartId, startDate, endDate, journalId, grossCommission, adjustmentsJson, netCommission, snapshotJson
    ) VALUES (
      @chartId, @startDate, @endDate, @journalId, @grossCommission, @adjustmentsJson, @netCommission, @snapshotJson
    )
  `,
  deleteSettlementById: `
    DELETE FROM agent_commission_settlements WHERE id = @id
  `,
};

interface SaleLineRawRow {
  invoiceId: number;
  invoiceNumber: number;
  invoiceDate: string;
  accountId: number;
  accountName: string;
  accountCode: string | number | null;
  inventoryId: number;
  itemName: string;
  itemDescription: string | null;
  itemTypeId: number | null;
  itemTypeName: string;
  quantity: number;
  price: number;
  discount: number;
  netPrice: number | null;
}

@logErrors
export class CommissionService {
  private db: DatabaseDriver;

  private journalService: JournalService;

  constructor(deps: { db: DatabaseDriver; journalService: JournalService }) {
    this.db = deps.db;
    this.journalService = deps.journalService;
  }

  async getCommissionConfig(chartId: number): Promise<AgentCommissionConfig> {
    const row = await this.db.get<{
      id: number;
      chartId: number;
      payableAccountId: number | null;
      expenseAccountId: number | null;
      ratesJson: string;
      overridesJson: string;
      createdAt: string;
      updatedAt: string;
    }>(SQL.getCommissionConfig, { chartId });

    if (!row) {
      return {
        chartId,
        payableAccountId: null,
        expenseAccountId: null,
        rates: [],
        overrides: [],
      };
    }

    let rates: AgentCommissionConfig['rates'] = [];
    let overrides: AgentCommissionConfig['overrides'] = [];

    try {
      const parsed = JSON.parse(row.ratesJson || '[]');
      if (Array.isArray(parsed)) {
        rates = parsed.map((r: Record<string, unknown>) => ({
          itemTypeId: Number(r.itemTypeId),
          percent: Number(r.percent ?? r.normalCommissionPct ?? 0),
          netRatePercent: Number(
            r.netRatePercent ?? r.netRateCommissionPct ?? 0,
          ),
        }));
      }
    } catch {
      rates = [];
    }

    try {
      const parsed = JSON.parse(row.overridesJson || '[]');
      if (Array.isArray(parsed)) {
        overrides = parsed.map((o: Record<string, unknown>) => ({
          inventoryId: Number(o.inventoryId),
          rupeesPerUnit: Number(o.rupeesPerUnit ?? 0),
        }));
      }
    } catch {
      overrides = [];
    }

    return {
      id: row.id,
      chartId: row.chartId,
      payableAccountId: row.payableAccountId,
      expenseAccountId: row.expenseAccountId,
      rates,
      overrides,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async saveCommissionConfig(
    config: AgentCommissionConfig,
  ): Promise<AgentCommissionConfig> {
    const normalizedRates: AgentCommissionTypeRate[] = (config.rates || []).map(
      (r) => ({
        itemTypeId: Number(r.itemTypeId),
        percent: Number(r.percent ?? r.normalCommissionPct ?? 0),
        netRatePercent: Number(r.netRatePercent ?? r.netRateCommissionPct ?? 0),
      }),
    );

    const ratesJson = JSON.stringify(normalizedRates);
    const overridesJson = JSON.stringify(config.overrides ?? []);

    await this.db.run(SQL.upsertCommissionConfig, {
      chartId: config.chartId,
      payableAccountId: config.payableAccountId ?? null,
      expenseAccountId: config.expenseAccountId ?? null,
      ratesJson,
      overridesJson,
    });

    return this.getCommissionConfig(config.chartId);
  }

  async getCommissionReport(
    chartId: number,
    startDate: string,
    endDate: string,
  ): Promise<AgentCommissionReport> {
    const agent = await this.db.get<{
      id: number;
      name: string;
      nameUrdu: string | null;
    }>(SQL.getAgentHead, { chartId });

    const agentName = agent?.name ?? `Agent #${chartId}`;
    const agentNameUrdu = agent?.nameUrdu ?? null;

    const config = await this.getCommissionConfig(chartId);
    const ratesByItemTypeId = new Map(
      config.rates.map((r) => [r.itemTypeId, r]),
    );
    const overridesByInventoryId = new Map(
      config.overrides.map((o) => [o.inventoryId, o.rupeesPerUnit]),
    );

    const rawLines = await this.db.all<SaleLineRawRow>(
      SQL.getSaleLinesForAgent,
      {
        chartId,
        startDate,
        endDate,
      },
    );

    const lines: CommissionReportItemLine[] = [];
    const missingTypesSet = new Set<string>();

    for (const raw of rawLines) {
      const hasNetPrice = raw.netPrice != null && Number.isFinite(raw.netPrice);
      const chargedAmount = hasNetPrice
        ? raw.quantity * raw.netPrice!
        : raw.quantity * raw.price * (1 - (raw.discount || 0) / 100);

      let rateType: CommissionReportItemLine['rateType'] = 'missing';
      let rateValue = 0;
      let commissionAmount = 0;

      if (!hasNetPrice) {
        // Normal sale line -> uses agent's item-type normal percent
        if (raw.itemTypeId != null && ratesByItemTypeId.has(raw.itemTypeId)) {
          const rateConfig = ratesByItemTypeId.get(raw.itemTypeId)!;
          const normalPct = Number(
            rateConfig.percent ?? rateConfig.normalCommissionPct ?? 0,
          );
          rateType = 'normal_pct';
          rateValue = normalPct;
          commissionAmount = (chargedAmount * normalPct) / 100;
        } else {
          rateType = 'missing';
          rateValue = 0;
          commissionAmount = 0;
          missingTypesSet.add(raw.itemTypeName || `Unknown Type`);
        }
      } else {
        // Net-rate sale line -> check SKU rupee override first
        const overrideRupees = overridesByInventoryId.get(raw.inventoryId);
        if (overrideRupees !== undefined) {
          rateType = 'sku_override';
          rateValue = Number(overrideRupees) || 0;
          commissionAmount = raw.quantity * rateValue;
        } else if (
          raw.itemTypeId != null &&
          ratesByItemTypeId.has(raw.itemTypeId)
        ) {
          const rateConfig = ratesByItemTypeId.get(raw.itemTypeId)!;
          const netPct = Number(
            rateConfig.netRatePercent ?? rateConfig.netRateCommissionPct ?? 0,
          );
          rateType = 'net_pct';
          rateValue = netPct;
          commissionAmount = (chargedAmount * netPct) / 100;
        } else {
          rateType = 'missing';
          rateValue = 0;
          commissionAmount = 0;
          missingTypesSet.add(raw.itemTypeName || `Unknown Type`);
        }
      }

      lines.push({
        invoiceId: raw.invoiceId,
        invoiceNumber: raw.invoiceNumber,
        invoiceDate: raw.invoiceDate,
        accountId: raw.accountId,
        accountName: raw.accountName,
        accountCode: raw.accountCode != null ? String(raw.accountCode) : null,
        inventoryId: raw.inventoryId,
        itemName: raw.itemName,
        itemDescription: raw.itemDescription ?? null,
        itemTypeId: raw.itemTypeId,
        itemTypeName: raw.itemTypeName,
        quantity: raw.quantity,
        price: raw.price,
        discount: raw.discount,
        netPrice: raw.netPrice,
        chargedAmount: Math.round(chargedAmount * 100) / 100,
        rateType,
        rateValue,
        commissionAmount: Math.round(commissionAmount * 100) / 100,
      });
    }

    // Group lines into buckets
    const bucketMap = new Map<string, CommissionReportBucket>();

    for (const line of lines) {
      let bucketKey = '';
      let bucketTitle = '';
      const safeRateValue = Number(line.rateValue) || 0;

      if (line.rateType === 'normal_pct') {
        bucketKey = `normal:${line.itemTypeId ?? 'none'}:${safeRateValue}`;
        bucketTitle = `${
          line.itemTypeName || 'Unknown'
        } (Sale ${safeRateValue.toFixed(2)}%)`;
      } else if (line.rateType === 'net_pct') {
        bucketKey = `net:${line.itemTypeId ?? 'none'}:${safeRateValue}`;
        bucketTitle = `${
          line.itemTypeName || 'Unknown'
        } (Net-Rate ${safeRateValue.toFixed(2)}%)`;
      } else if (line.rateType === 'sku_override') {
        bucketKey = `sku:${line.inventoryId}:${safeRateValue}`;
        bucketTitle = `${line.itemName} (Override Rs. ${safeRateValue.toFixed(
          2,
        )}/unit)`;
      } else {
        bucketKey = `missing:${line.itemTypeName || 'unknown'}`;
        bucketTitle = `${
          line.itemTypeName || 'Unknown'
        } (No Rate Configured - 0%)`;
      }

      let bucket = bucketMap.get(bucketKey);
      if (!bucket) {
        bucket = {
          key: bucketKey,
          title: bucketTitle,
          ruleType: line.rateType,
          rateValue: line.rateValue,
          totalQty: 0,
          totalCharged: 0,
          totalCommission: 0,
          lines: [],
        };
        bucketMap.set(bucketKey, bucket);
      }

      bucket.totalQty += line.quantity;
      bucket.totalCharged += line.chargedAmount;
      bucket.totalCommission += line.commissionAmount;
      bucket.lines.push(line);
    }

    const buckets = Array.from(bucketMap.values()).map((b) => ({
      ...b,
      totalCharged: Math.round(b.totalCharged * 100) / 100,
      totalCommission: Math.round(b.totalCommission * 100) / 100,
    }));

    const totalQty = lines.reduce((acc, l) => acc + l.quantity, 0);
    const totalCharged =
      Math.round(lines.reduce((acc, l) => acc + l.chargedAmount, 0) * 100) /
      100;
    const grossCommission =
      Math.round(lines.reduce((acc, l) => acc + l.commissionAmount, 0) * 100) /
      100;

    // Check for existing settlement
    const settlementRow = await this.db.get<{
      id: number;
      chartId: number;
      startDate: string;
      endDate: string;
      journalId: number | null;
      grossCommission: number;
      adjustmentsJson: string;
      netCommission: number;
      snapshotJson: string;
      createdAt: string;
      updatedAt: string;
    }>(SQL.getSettlement, { chartId, startDate, endDate });

    let settlement: AgentCommissionSettlement | null = null;
    if (settlementRow) {
      let adjustments: CommissionAdjustment[] = [];
      try {
        adjustments = JSON.parse(settlementRow.adjustmentsJson || '[]');
      } catch {
        adjustments = [];
      }
      settlement = {
        ...settlementRow,
        adjustments,
      };
    }

    return {
      agentId: chartId,
      agentName,
      agentNameUrdu,
      payableAccountId: config.payableAccountId,
      expenseAccountId: config.expenseAccountId,
      startDate,
      endDate,
      totalQty,
      totalCharged,
      grossCommission,
      missingRateItemTypes: Array.from(missingTypesSet),
      buckets,
      settlement,
    };
  }

  async postCommissionSettlement(
    payload: PostCommissionSettlementPayload,
  ): Promise<AgentCommissionSettlement> {
    const report = await this.getCommissionReport(
      payload.chartId,
      payload.startDate,
      payload.endDate,
    );

    const adjustmentsSum = (payload.adjustments ?? []).reduce(
      (acc, adj) => acc + (Number(adj.amount) || 0),
      0,
    );
    const netCommission =
      Math.round((report.grossCommission + adjustmentsSum) * 100) / 100;

    // Generate clear narration lines
    const narrationLines = [
      `Commission settlement for ${report.agentName} (${payload.startDate} to ${payload.endDate})`,
      `Gross Commission: Rs. ${report.grossCommission.toLocaleString()}`,
    ];

    if (payload.adjustments && payload.adjustments.length > 0) {
      for (const adj of payload.adjustments) {
        const sign = adj.amount >= 0 ? '+' : '';
        narrationLines.push(
          `${adj.description}: ${sign}Rs. ${adj.amount.toLocaleString()}`,
        );
      }
    }
    narrationLines.push(`Net Payable: Rs. ${netCommission.toLocaleString()}`);

    const narration = narrationLines.join(' | ');

    // Post 2-line journal entry: Dr Expense / Cr Payable
    const journalEntries = [
      {
        id: -1,
        journalId: 0,
        accountId: payload.expenseAccountId,
        debitAmount: netCommission,
        creditAmount: 0,
      },
      {
        id: -1,
        journalId: 0,
        accountId: payload.payableAccountId,
        debitAmount: 0,
        creditAmount: netCommission,
      },
    ];

    await this.journalService.insertJournal({
      id: -1,
      date: payload.postingDate,
      narration,
      isPosted: true,
      journalEntries,
    });

    // Retrieve inserted journalId by narration and date
    const latestJournal = await this.db.get<{ id: number }>(
      `SELECT id FROM journal WHERE narration = @narration AND date = @date ORDER BY id DESC LIMIT 1`,
      { narration, date: payload.postingDate },
    );
    const journalId = latestJournal?.id ?? null;

    // Snapshot all calculated lines
    const snapshotLines = report.buckets.flatMap((b) => b.lines);
    const snapshotJson = JSON.stringify(snapshotLines);
    const adjustmentsJson = JSON.stringify(payload.adjustments ?? []);

    const result = await this.db.run(SQL.insertSettlement, {
      chartId: payload.chartId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      journalId,
      grossCommission: report.grossCommission,
      adjustmentsJson,
      netCommission,
      snapshotJson,
    });

    const settlementId = Number(result.lastInsertRowid);
    const saved = await this.db.get<AgentCommissionSettlement>(
      SQL.getSettlementById,
      { id: settlementId },
    );

    return {
      ...saved!,
      adjustments: payload.adjustments,
    };
  }

  async unpostCommissionSettlement(settlementId: number): Promise<boolean> {
    const settlement = await this.db.get<{
      id: number;
      journalId: number | null;
    }>(SQL.getSettlementById, { id: settlementId });

    if (!settlement) {
      return false;
    }

    if (settlement.journalId) {
      await this.journalService.removeLedgerEffectOfJournals([
        settlement.journalId,
      ]);
      await this.journalService.deleteJournalsByIds([settlement.journalId]);
    }

    await this.db.run(SQL.deleteSettlementById, { id: settlementId });
    return true;
  }
}
