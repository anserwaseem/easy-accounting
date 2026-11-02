import { trim } from 'lodash';
import type {
  Cheque,
  ChequeStatus,
  ClearChequeInput,
  RecordChequeInput,
  AddPresentmentInput,
  TransferCustodyInput,
  ChequeHolder,
  Journal,
} from '../../types';
import type { DatabaseDriver } from '../db/driver';
import type { SessionContext } from '../ports';
import type { JournalService } from './JournalService';
import { logErrors } from '../errorLogger';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

interface ChequeRow {
  id: number;
  chartId: number;
  tourId: number | null;
  chequeNumber: string;
  bankName: string | null;
  branchName: string | null;
  amount: number;
  receivedDate: string;
  expectedClearanceDate: string | null;
  status: ChequeStatus;
  holder: ChequeHolder;
  heldForCommission: number;
  transferredToAgentAt: string | null;
  commissionSettlementId: number | null;
  commissionAppliedAmount: number | null;
  clearedJournalId: number | null;
  actualClearanceDate: string | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface AllocationRow {
  id: number;
  chequeId: number;
  accountId: number;
  amount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

interface PresentmentRow {
  id: number;
  chequeId: number;
  attemptNumber: number;
  presentmentDate: string;
  bankReference: string | null;
  outcome: 'pending' | 'cleared' | 'bounced';
  actualClearanceDate: string | null;
  bankFee: number;
  notes: string | null;
  journalId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface CustodyRow {
  id: number;
  chequeId: number;
  fromHolder: string | null;
  toHolder: string;
  eventDate: string;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const SQL = {
  getById: `SELECT id, chartId, tourId, chequeNumber, bankName, branchName, amount,
      receivedDate, expectedClearanceDate, status, holder, heldForCommission,
      transferredToAgentAt, commissionSettlementId, commissionAppliedAmount,
      clearedJournalId, actualClearanceDate, notes, createdAt, updatedAt
    FROM cheques WHERE id = @id`,
  listByFilters: `SELECT id, chartId, tourId, chequeNumber, bankName, branchName, amount,
      receivedDate, expectedClearanceDate, status, holder, heldForCommission,
      transferredToAgentAt, commissionSettlementId, commissionAppliedAmount,
      clearedJournalId, actualClearanceDate, notes, createdAt, updatedAt
    FROM cheques
    WHERE (@chartId IS NULL OR chartId = @chartId)
      AND (@tourId IS NULL OR tourId = @tourId)
      AND (@status IS NULL OR status = @status)
      AND (@holder IS NULL OR holder = @holder)
    ORDER BY receivedDate DESC, id DESC`,
  insertCheque: `INSERT INTO cheques (chartId, tourId, chequeNumber, bankName, branchName,
      amount, receivedDate, expectedClearanceDate, status, holder, notes)
    VALUES (@chartId, @tourId, @chequeNumber, @bankName, @branchName, @amount,
      @receivedDate, @expectedClearanceDate, 'pending', 'business', @notes)`,
  insertAllocation: `INSERT INTO cheque_allocations (chequeId, accountId, amount)
    VALUES (@chequeId, @accountId, @amount)`,
  getAllocations: `SELECT id, chequeId, accountId, amount, createdAt, updatedAt
    FROM cheque_allocations WHERE chequeId = @chequeId`,
  getPresentments: `SELECT id, chequeId, attemptNumber, presentmentDate, bankReference,
      outcome, actualClearanceDate, bankFee, notes, journalId, createdAt, updatedAt
    FROM cheque_presentments WHERE chequeId = @chequeId ORDER BY attemptNumber ASC`,
  getCustody: `SELECT id, chequeId, fromHolder, toHolder, eventDate, notes, createdAt, updatedAt
    FROM cheque_custody_events WHERE chequeId = @chequeId ORDER BY id ASC`,
  countPresentments: `SELECT COUNT(*) AS c FROM cheque_presentments WHERE chequeId = @chequeId`,
  insertPresentment: `INSERT INTO cheque_presentments (chequeId, attemptNumber, presentmentDate,
      bankReference, outcome, actualClearanceDate, bankFee, notes, journalId)
    VALUES (@chequeId, @attemptNumber, @presentmentDate, @bankReference, @outcome,
      @actualClearanceDate, @bankFee, @notes, @journalId)`,
  insertCustody: `INSERT INTO cheque_custody_events (chequeId, fromHolder, toHolder, eventDate, notes)
    VALUES (@chequeId, @fromHolder, @toHolder, @eventDate, @notes)`,
  updateStatus: `UPDATE cheques SET status = @status, actualClearanceDate = @actualClearanceDate,
      clearedJournalId = @clearedJournalId, commissionSettlementId = @commissionSettlementId,
      commissionAppliedAmount = @commissionAppliedAmount WHERE id = @id`,
  updateHolder: `UPDATE cheques SET holder = @holder, transferredToAgentAt = @transferredToAgentAt,
      heldForCommission = @heldForCommission WHERE id = @id`,
};

const ensure = async (cond: boolean, msg: string): Promise<void> => {
  if (!cond) throw new Error(msg);
};

@logErrors
export class ChequeService {
  private db: DatabaseDriver;

  private session: SessionContext;

  private journalService: JournalService;

  constructor(deps: {
    db: DatabaseDriver;
    session: SessionContext;
    journalService: JournalService;
  }) {
    this.db = deps.db;
    this.session = deps.session;
    this.journalService = deps.journalService;
  }

  private async ownsCheque(id: number): Promise<ChequeRow> {
    const row = await this.db.get<ChequeRow>(SQL.getById, { id });
    if (!row) throw new Error('Cheque not found');
    return row;
  }

  // eslint-disable-next-line class-methods-use-this
  private mapCheque(
    row: ChequeRow,
    allocations: AllocationRow[],
    presentments: PresentmentRow[],
    custody: CustodyRow[],
  ): Cheque {
    return {
      id: row.id,
      chartId: row.chartId,
      tourId: row.tourId,
      chequeNumber: row.chequeNumber,
      bankName: row.bankName,
      branchName: row.branchName,
      amount: row.amount,
      receivedDate: row.receivedDate,
      expectedClearanceDate: row.expectedClearanceDate,
      status: row.status,
      holder: row.holder,
      heldForCommission: row.heldForCommission === 1,
      transferredToAgentAt: row.transferredToAgentAt,
      commissionSettlementId: row.commissionSettlementId,
      commissionAppliedAmount: row.commissionAppliedAmount,
      clearedJournalId: row.clearedJournalId,
      actualClearanceDate: row.actualClearanceDate,
      notes: row.notes,
      custodyEvents: custody.map((c) => ({
        id: c.id,
        chequeId: c.chequeId,
        fromHolder: c.fromHolder as ChequeHolder | null,
        toHolder: c.toHolder as ChequeHolder,
        eventDate: c.eventDate,
        notes: c.notes,
        createdAt: c.createdAt ?? undefined,
        updatedAt: c.updatedAt ?? undefined,
      })),
      allocations: allocations.map((a) => ({
        id: a.id,
        chequeId: a.chequeId,
        accountId: a.accountId,
        amount: a.amount,
        createdAt: a.createdAt ?? undefined,
        updatedAt: a.updatedAt ?? undefined,
      })),
      presentments: presentments.map((p) => ({
        id: p.id,
        chequeId: p.chequeId,
        attemptNumber: p.attemptNumber,
        presentmentDate: p.presentmentDate,
        bankReference: p.bankReference,
        outcome: p.outcome,
        actualClearanceDate: p.actualClearanceDate,
        bankFee: p.bankFee,
        notes: p.notes,
        journalId: p.journalId,
        createdAt: p.createdAt ?? undefined,
        updatedAt: p.updatedAt ?? undefined,
      })),
      createdAt: row.createdAt ?? undefined,
      updatedAt: row.updatedAt ?? undefined,
    };
  }

  async getCheque(id: number): Promise<Cheque> {
    const row = await this.ownsCheque(id);
    const allocations = await this.db.all<AllocationRow>(SQL.getAllocations, {
      chequeId: id,
    });
    const presentments = await this.db.all<PresentmentRow>(
      SQL.getPresentments,
      {
        chequeId: id,
      },
    );
    const custody = await this.db.all<CustodyRow>(SQL.getCustody, {
      chequeId: id,
    });
    return this.mapCheque(row, allocations, presentments, custody);
  }

  async listCheques(filters?: {
    chartId?: number;
    tourId?: number;
    status?: ChequeStatus;
    holder?: ChequeHolder;
  }): Promise<Cheque[]> {
    const rows = await this.db.all<ChequeRow>(SQL.listByFilters, {
      chartId: filters?.chartId ?? null,
      tourId: filters?.tourId ?? null,
      status: filters?.status ?? null,
      holder: filters?.holder ?? null,
    });
    const out: Cheque[] = [];
    for (const r of rows) {
      // eslint-disable-next-line no-await-in-loop
      const allocations = await this.db.all<AllocationRow>(SQL.getAllocations, {
        chequeId: r.id,
      });
      // eslint-disable-next-line no-await-in-loop
      const presentments = await this.db.all<PresentmentRow>(
        SQL.getPresentments,
        { chequeId: r.id },
      );
      // eslint-disable-next-line no-await-in-loop
      const custody = await this.db.all<CustodyRow>(SQL.getCustody, {
        chequeId: r.id,
      });
      out.push(this.mapCheque(r, allocations, presentments, custody));
    }
    return out;
  }

  async recordReceivedCheque(input: RecordChequeInput): Promise<number> {
    const chequeNumber = trim(input.chequeNumber ?? '');
    await ensure(Boolean(chequeNumber), 'Cheque number is required');
    await ensure(
      ISO_DAY.test(input.receivedDate ?? ''),
      'Received date must be yyyy-MM-dd',
    );
    await ensure(Number(input.amount) > 0, 'Cheque amount must be > 0');
    await ensure(
      Array.isArray(input.allocations) && input.allocations.length > 0,
      'At least one allocation is required',
    );

    const total = input.allocations.reduce(
      (s, a) => s + Number(a.amount || 0),
      0,
    );
    await ensure(
      Math.abs(total - Number(input.amount)) < 0.001,
      'Allocation amounts must sum to cheque amount',
    );

    for (const a of input.allocations) {
      // eslint-disable-next-line no-await-in-loop
      await ensure(Number(a.amount) > 0, 'Allocation amount must be > 0');
    }

    const result = await this.db.transaction(async () => {
      const res = await this.db.run(SQL.insertCheque, {
        chartId: input.chartId,
        tourId: input.tourId ?? null,
        chequeNumber,
        bankName: input.bankName ?? null,
        branchName: input.branchName ?? null,
        amount: input.amount,
        receivedDate: input.receivedDate,
        expectedClearanceDate: input.expectedClearanceDate ?? null,
        notes: input.notes ?? null,
      });
      const chequeId = Number(res.lastInsertRowid);
      for (const a of input.allocations) {
        // eslint-disable-next-line no-await-in-loop
        await this.db.run(SQL.insertAllocation, {
          chequeId,
          accountId: a.accountId,
          amount: a.amount,
        });
      }
      // initial custody event
      await this.db.run(SQL.insertCustody, {
        chequeId,
        fromHolder: null,
        toHolder: 'business',
        eventDate: input.receivedDate,
        notes: 'received',
      });
      return chequeId;
    });
    return result;
  }

  async addPresentment(input: AddPresentmentInput): Promise<number> {
    const cheque = await this.ownsCheque(input.chequeId);
    await ensure(cheque.status !== 'cleared', 'Cheque is already cleared');

    await ensure(
      input.outcome !== 'cleared',
      'Use clearCheque to record a clearance with posting',
    );

    const count = await this.db.get<{ c: number }>(SQL.countPresentments, {
      chequeId: input.chequeId,
    });
    const attemptNumber = (count?.c ?? 0) + 1;

    const res = await this.db.run(SQL.insertPresentment, {
      chequeId: input.chequeId,
      attemptNumber,
      presentmentDate: input.presentmentDate,
      bankReference: input.bankReference ?? null,
      outcome: input.outcome,
      actualClearanceDate: input.actualClearanceDate ?? null,
      bankFee: input.bankFee ?? 0,
      notes: input.notes ?? null,
      journalId: null,
    });

    // status transition
    const newStatus: ChequeStatus =
      input.outcome === 'bounced' ? 'bounced' : 'presented';
    if (cheque.status !== 'cleared') {
      await this.db.run(
        `UPDATE cheques SET status = @status WHERE id = @id AND status != 'cleared'`,
        { status: newStatus, id: input.chequeId },
      );
    }
    return Number(res.lastInsertRowid);
  }

  async clearCheque(input: ClearChequeInput): Promise<Cheque> {
    const cheque = await this.ownsCheque(input.chequeId);
    await ensure(cheque.status !== 'cleared', 'Cheque is already cleared');
    await ensure(
      ISO_DAY.test(input.actualClearanceDate),
      'Actual clearance date must be yyyy-MM-dd',
    );
    await ensure(
      Number(input.bankAccountId) > 0,
      'Bank account is required to clear a cheque',
    );

    const allocations = await this.db.all<AllocationRow>(SQL.getAllocations, {
      chequeId: input.chequeId,
    });
    await ensure(allocations.length > 0, 'Cheque has no allocations');

    const total = allocations.reduce((s, a) => s + Number(a.amount || 0), 0);
    await ensure(
      Math.abs(total - Number(cheque.amount)) < 0.001,
      'Allocation total mismatch',
    );

    return this.db.transaction(async () => {
      // resolve/create presentment
      let presentmentId = input.presentmentId ?? null;
      const count = await this.db.get<{ c: number }>(SQL.countPresentments, {
        chequeId: input.chequeId,
      });
      const attemptNumber = (count?.c ?? 0) + (presentmentId ? 0 : 1);

      if (!presentmentId) {
        const res = await this.db.run(SQL.insertPresentment, {
          chequeId: input.chequeId,
          attemptNumber,
          presentmentDate: input.actualClearanceDate,
          bankReference: null,
          outcome: 'cleared',
          actualClearanceDate: input.actualClearanceDate,
          bankFee: 0,
          notes: 'clearance',
          journalId: null,
        });
        presentmentId = Number(res.lastInsertRowid);
      }

      // post receipt journal: Dr bank, Cr allocations
      const journalEntries = [
        {
          id: -1,
          journalId: 0,
          accountId: input.bankAccountId,
          debitAmount: cheque.amount,
          creditAmount: 0,
        },
        ...allocations.map((a) => ({
          id: -1,
          journalId: 0,
          accountId: a.accountId,
          debitAmount: 0,
          creditAmount: a.amount,
        })),
      ];
      await this.journalService.insertJournal({
        id: -1,
        date: input.actualClearanceDate,
        narration: `Cheque clearance #${cheque.chequeNumber} (${input.actualClearanceDate})`,
        isPosted: true,
        journalEntries,
      } as unknown as Journal);

      // retrieve journal id
      const latest = await this.db.get<{ id: number }>(
        `SELECT id FROM journal WHERE narration = @narration AND date = @date ORDER BY id DESC LIMIT 1`,
        {
          narration: `Cheque clearance #${cheque.chequeNumber} (${input.actualClearanceDate})`,
          date: input.actualClearanceDate,
        },
      );
      const journalId = latest?.id ?? null;

      await this.db.run(
        `UPDATE cheque_presentments SET journalId = @journalId, outcome = 'cleared', actualClearanceDate = @date
         WHERE id = @id`,
        { journalId, date: input.actualClearanceDate, id: presentmentId },
      );

      await this.db.run(SQL.updateStatus, {
        status: 'cleared',
        actualClearanceDate: input.actualClearanceDate,
        clearedJournalId: journalId,
        commissionSettlementId: input.commissionSettlementId ?? null,
        commissionAppliedAmount: input.commissionAppliedAmount ?? null,
        id: input.chequeId,
      });

      return this.getCheque(input.chequeId);
    });
  }

  async markBounced(
    chequeId: number,
    presentmentDate: string,
    notes?: string | null,
  ): Promise<number> {
    const cheque = await this.ownsCheque(chequeId);
    await ensure(cheque.status !== 'cleared', 'Cheque is already cleared');
    await ensure(
      ISO_DAY.test(presentmentDate),
      'Presentment date must be yyyy-MM-dd',
    );

    const count = await this.db.get<{ c: number }>(SQL.countPresentments, {
      chequeId,
    });
    const attemptNumber = (count?.c ?? 0) + 1;

    const res = await this.db.run(SQL.insertPresentment, {
      chequeId,
      attemptNumber,
      presentmentDate,
      bankReference: null,
      outcome: 'bounced',
      actualClearanceDate: null,
      bankFee: 0,
      notes: notes ?? null,
      journalId: null,
    });

    await this.db.run(
      `UPDATE cheques SET status = 'bounced' WHERE id = @id AND status != 'cleared'`,
      { id: chequeId },
    );
    return Number(res.lastInsertRowid);
  }

  async transferCustody(input: TransferCustodyInput): Promise<void> {
    const cheque = await this.ownsCheque(input.chequeId);
    await ensure(
      cheque.status !== 'cleared',
      'Cannot transfer a cleared cheque',
    );
    await ensure(
      ISO_DAY.test(input.eventDate),
      'Event date must be yyyy-MM-dd',
    );

    await this.db.transaction(async () => {
      await this.db.run(SQL.insertCustody, {
        chequeId: input.chequeId,
        fromHolder: cheque.holder,
        toHolder: input.toHolder,
        eventDate: input.eventDate,
        notes: input.notes ?? null,
      });
      const heldForCommission =
        input.heldForCommission || cheque.heldForCommission ? 1 : 0;
      await this.db.run(SQL.updateHolder, {
        holder: input.toHolder,
        transferredToAgentAt:
          input.toHolder === 'agent'
            ? input.eventDate
            : cheque.transferredToAgentAt,
        heldForCommission,
        id: input.chequeId,
      });
    });
  }

  async getUnresolvedCheques(filters?: {
    chartId?: number;
    tourId?: number;
  }): Promise<Cheque[]> {
    const all = await this.listCheques({
      chartId: filters?.chartId,
      tourId: filters?.tourId,
    });
    return all.filter((c) => c.status !== 'cleared');
  }

  async applyToCommission(
    chequeId: number,
    settlementId: number,
    amount: number,
  ): Promise<void> {
    const cheque = await this.ownsCheque(chequeId);
    await ensure(
      cheque.commissionSettlementId == null,
      'Cheque already linked to a commission settlement',
    );
    await ensure(amount > 0, 'Applied amount must be > 0');
    await ensure(
      amount <= cheque.amount + 0.001,
      'Applied amount exceeds cheque amount',
    );

    const settlement = await this.db.get<{ netCommission: number | null }>(
      `SELECT netCommission FROM agent_tour_collection_settlements WHERE id = @id`,
      { id: settlementId },
    );
    if (settlement) {
      const paidRow = await this.db.get<{ paid: number | null }>(
        `SELECT COALESCE(SUM(commissionAppliedAmount), 0) AS paid
         FROM cheques
         WHERE commissionSettlementId = @id AND id != @chequeId`,
        { id: settlementId, chequeId },
      );
      const paid = paidRow?.paid ?? 0;
      const remaining = (settlement.netCommission ?? 0) - paid;
      await ensure(
        amount <= remaining + 0.001,
        'Applied amount exceeds outstanding commission payable',
      );
    }

    await this.db.run(SQL.updateStatus, {
      status: cheque.status,
      actualClearanceDate: cheque.actualClearanceDate,
      clearedJournalId: cheque.clearedJournalId,
      commissionSettlementId: settlementId,
      commissionAppliedAmount: amount,
      id: chequeId,
    });
  }
}
