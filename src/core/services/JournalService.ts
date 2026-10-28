/* eslint-disable no-lonely-if */
import { compact, has, omit } from 'lodash';
import {
  AccountType,
  BalanceType,
  type Journal,
  type JournalEntry,
  type JournalNarrationSummary,
  type JournalReference,
  type Ledger,
  type UpdateJournalFields,
} from '../../types';
import type { DatabaseDriver } from '../db/driver';
import type { SessionContext } from '../ports';
import { cast, raise } from '../utils/sqlite';
import { logErrors } from '../errorLogger';
import { OPENING_BALANCE_PARTICULARS } from '../db/openingBalanceBackfill';
import { LedgerService } from './LedgerService';
import { assertActiveAccounts } from './accountGuards';

const SQL = {
  insertJournal: `INSERT INTO journal (date, narration, isPosted, billNumber, discountPercentage, invoiceId, reversesJournalUuid)
       VALUES (@date, @narration, @isPosted, @billNumber, @discountPercentage, @invoiceId, @reversesJournalUuid)`,
  insertJournalEntry: `INSERT INTO journal_entry (journalId, debitAmount, accountId, creditAmount)
       VALUES (@journalId, @debitAmount, @accountId, @creditAmount)`,
  accountType:
    'SELECT c.type FROM account a JOIN chart c ON a.chartId = c.id WHERE a.id = ?',
  nextJournalId: 'SELECT COALESCE(MAX(id), 0) as maxId FROM journal',
  // List query only. Opening-balance journals (OPENING_BALANCE_PARTICULARS)
  // are structural — backfilled from pre-025 desktop imports, or written by
  // the balance-sheet-upload flow — and were never shown in the desktop
  // journals list; that is the correct behavior on every platform. Their
  // ledger effects still show on account ledgers, and math/statements never
  // read this query. The literal is quote-free (see its own doc comment) so
  // interpolating it directly into the SQL string is safe.
  getJournals: `SELECT j.id, j.uuid, j.reversesJournalUuid, j.date, j.narration, j.isPosted, j.billNumber, j.discountPercentage, j.invoiceId, j.createdAt, j.updatedAt, je.debitAmount,
       EXISTS(SELECT 1 FROM journal rev WHERE rev.reversesJournalUuid = j.uuid) AS hasReversal
       FROM journal j
       JOIN journal_entry je ON j.id = je.journalId
       JOIN account a ON a.id = je.accountId
       JOIN chart c ON c.id = a.chartId
       WHERE userId = (SELECT id FROM users WHERE username = @username)
       AND j.narration != '${OPENING_BALANCE_PARTICULARS}'
       ORDER BY j.date DESC, j.id DESC`,
  getJournalsByInvoiceId: `SELECT j.id, j.date, j.narration, j.isPosted, j.billNumber, j.discountPercentage, j.invoiceId, j.createdAt, j.updatedAt, je.debitAmount
       FROM journal j
       JOIN journal_entry je ON j.id = je.journalId
       JOIN account a ON a.id = je.accountId
       JOIN chart c ON c.id = a.chartId
       WHERE j.invoiceId = @invoiceId
       AND userId = (SELECT id FROM users WHERE username = @username)
       ORDER BY j.date DESC, j.id DESC`,
  getJournal: `SELECT j.id, j.uuid, j.date, j.narration, j.isPosted, j.billNumber, j.discountPercentage, j.invoiceId, j.reversesJournalUuid, j.createdAt, j.updatedAt,
              je.debitAmount, je.creditAmount, je.accountId, a.name as accountName
       FROM journal j
       JOIN journal_entry je ON j.id = je.journalId
       JOIN account a ON a.id = je.accountId
       JOIN chart c ON c.id = a.chartId
       WHERE j.id = @journalId
       AND userId = (SELECT id FROM users WHERE username = @username)`,
  insertLedger: `INSERT INTO ledger (date, accountId, debit, credit, balance, balanceType, particulars, linkedAccountId)
       VALUES (@date, @accountId, @debit, @credit, @balance, @balanceType, @particulars, @linkedAccountId)`,
  updateJournalNarration: `UPDATE journal SET narration = @narration WHERE id = @journalId`,
  getJournalIdsByInvoiceId: 'SELECT id FROM journal WHERE invoiceId = ?',
  getAccountIdsByJournalIdsJson: `
      SELECT DISTINCT accountId
      FROM journal_entry
      WHERE journalId IN (SELECT value FROM json_each(@journalIdsJson))
    `,
  deleteJournalEntriesByJournalIdsJson: `
      DELETE FROM journal_entry
      WHERE journalId IN (SELECT value FROM json_each(@journalIdsJson))
    `,
  deleteJournalsByIdsJson: `
      DELETE FROM journal
      WHERE id IN (SELECT value FROM json_each(@journalIdsJson))
    `,
  getJournalNarrationSummariesByIdsJson: `
      SELECT DISTINCT
        j.id,
        j.narration,
        j.billNumber,
        j.discountPercentage,
        j.invoiceId
      FROM journal j
      JOIN journal_entry je ON j.id = je.journalId
      JOIN account a ON a.id = je.accountId
      JOIN chart c ON c.id = a.chartId
      WHERE j.id IN (SELECT value FROM json_each(@journalIdsJson))
        AND c.userId = (SELECT id FROM users WHERE username = @username)
    `,
  getSettlementByJournalId: `
      SELECT id FROM agent_commission_settlements WHERE journalId = @journalId LIMIT 1
    `,
  getReversalByOriginalJournalId: `
      SELECT id FROM journal
      WHERE reversesJournalUuid = @uuid
      LIMIT 1
    `,
  getJournalReferenceByUuid: `
      SELECT id, uuid, narration FROM journal WHERE uuid = @uuid
    `,
  getReversalsOfJournal: `
      SELECT id, uuid, narration FROM journal WHERE reversesJournalUuid = @uuid
    `,
};

/** drop `Reversal of Journal #<id>` so a synced narration does not name a local id */
const withoutLocalReversalId = (
  narration: string,
  journalId: number,
): string => {
  const exact = `Reversal of Journal #${journalId}`;
  if (narration === exact) return '';
  const prefix = `${exact}: `;
  if (narration.startsWith(prefix))
    return narration.slice(prefix.length).trim();
  return narration;
};

/** Journal CRUD. Async against DatabaseDriver, session injected. */
@logErrors
export class JournalService {
  private db: DatabaseDriver;

  private session: SessionContext;

  private ledgerService: LedgerService;

  constructor(deps: {
    db: DatabaseDriver;
    session: SessionContext;
    ledgerService: LedgerService;
  }) {
    this.db = deps.db;
    this.session = deps.session;
    this.ledgerService = deps.ledgerService;
  }

  /**
   * Resets sqlite_sequence for 'journal' back to MAX(id) if sequence drifted ahead
   * (e.g. after deleting mistaken tail journals). This guarantees that new journals
   * and getNextJournalId start strictly from MAX(id) + 1 without leaving artificial gaps.
   */
  private async syncJournalSequence(): Promise<void> {
    await this.db.run(
      `UPDATE sqlite_sequence
       SET seq = (SELECT COALESCE(MAX(id), 0) FROM journal)
       WHERE name = 'journal'
         AND seq > (SELECT COALESCE(MAX(id), 0) FROM journal)`,
    );
  }

  async getNextJournalId(): Promise<number> {
    await this.syncJournalSequence();
    const res = await this.db.get<{ maxId: number | null }>(SQL.nextJournalId);
    return (res?.maxId ?? 0) + 1;
  }

  async getJournals(): Promise<Journal[]> {
    const username = this.session.getUsername();
    const res = await this.db.all<
      Omit<Journal, 'hasReversal'> & {
        debitAmount: number;
        hasReversal: number;
      }
    >(SQL.getJournals, { username });

    const journals = compact(
      res.reduce((acc, journal) => {
        if (!acc[journal.id]) {
          acc[journal.id] = {
            ...omit(journal, 'debitAmount', 'hasReversal'),
            hasReversal: Boolean(journal.hasReversal),
            journalEntries: [],
          };
        }

        acc[journal.id].journalEntries.push({
          debitAmount: journal.debitAmount,
        } as JournalEntry);

        return acc;
      }, [] as Journal[]),
    );

    return journals;
  }

  async getJournalsByInvoiceId(invoiceId: number): Promise<Journal[]> {
    const username = this.session.getUsername();
    const res = await this.db.all<Journal & { debitAmount: number }>(
      SQL.getJournalsByInvoiceId,
      { invoiceId: cast(invoiceId), username },
    );

    const journals = compact(
      res.reduce((acc, journal) => {
        if (!acc[journal.id]) {
          acc[journal.id] = {
            ...omit(journal, 'debitAmount'),
            journalEntries: [],
          };
        }

        acc[journal.id].journalEntries.push({
          debitAmount: journal.debitAmount,
        } as JournalEntry);

        return acc;
      }, [] as Journal[]),
    );

    return journals;
  }

  async getJournal(journalId: number): Promise<Journal> {
    const username = this.session.getUsername();
    const res = await this.db.all<
      Journal & {
        debitAmount: number;
        creditAmount: number;
        accountName: string;
        accountId: number;
      }
    >(SQL.getJournal, { journalId, username });

    const journal = res.reduce((accParam, entry) => {
      let acc = accParam;
      if (!acc.id) {
        acc = omit(
          entry,
          'debitAmount',
          'creditAmount',
          'accountName',
          'accountId',
        );
        acc.journalEntries = [];
      }

      acc.journalEntries.push({
        debitAmount: entry.debitAmount,
        creditAmount: entry.creditAmount,
        accountName: entry.accountName,
        accountId: entry.accountId,
      } as JournalEntry & { accountName: string });

      return acc;
    }, {} as Journal);

    if (!journal.id) return journal;
    return this.attachReversalLinks(journal);
  }

  /** resolve the reversal link to journals that exist on this device */
  private async attachReversalLinks(journal: Journal): Promise<Journal> {
    const reverses = journal.reversesJournalUuid
      ? await this.db.get<JournalReference>(SQL.getJournalReferenceByUuid, {
          uuid: journal.reversesJournalUuid,
        })
      : undefined;
    const reversedBy = journal.uuid
      ? await this.db.all<JournalReference>(SQL.getReversalsOfJournal, {
          uuid: journal.uuid,
        })
      : [];
    return {
      ...journal,
      reverses: reverses ?? null,
      reversedBy,
    };
  }

  /**
   * one query for many ids — used to hydrate ledger narration column without per-row getJournal.
   */
  async getJournalNarrationSummariesByIds(
    journalIds: number[],
  ): Promise<Record<number, JournalNarrationSummary>> {
    const unique = [
      ...new Set(journalIds.filter((id) => Number.isInteger(id) && id > 0)),
    ];
    if (unique.length === 0) return {};

    const username = this.session.getUsername();
    const rows = await this.db.all<{
      id: number;
      narration: string | null;
      billNumber: number | null;
      discountPercentage: number | string | null;
      invoiceId: number | null;
    }>(SQL.getJournalNarrationSummariesByIdsJson, {
      journalIdsJson: JSON.stringify(unique),
      username,
    });

    const out: Record<number, JournalNarrationSummary> = {};
    for (const row of rows) {
      const summary: JournalNarrationSummary = {
        narration: row.narration ?? '',
      };
      if (row.billNumber != null) {
        summary.billNumber = row.billNumber;
      }
      if (row.discountPercentage != null) {
        summary.discountPercentage = row.discountPercentage;
      }
      if (row.invoiceId != null) {
        summary.invoiceId = row.invoiceId;
      }
      out[row.id] = summary;
    }
    return out;
  }

  async insertJournal(journalToBeInserted: Journal): Promise<boolean> {
    // invoice-linked journals are validated by InvoiceService (which also lets
    // an existing document keep a since-deactivated account), and a reversal
    // must be able to undo a journal that sits on a now-inactive account.
    const skipsActiveGuard =
      (journalToBeInserted.invoiceId ?? 0) > 0 ||
      Boolean(journalToBeInserted.reversesJournalUuid);
    if (!skipsActiveGuard) {
      await assertActiveAccounts(
        this.db,
        journalToBeInserted.journalEntries.map((entry) => entry.accountId),
        'Journal',
      );
    }
    try {
      return await this.db.transaction(async () => {
        const journal = journalToBeInserted;
        const { journalEntries } = journal;
        const debitEntries = journalEntries.filter((e) => e.debitAmount > 0);
        const creditEntries = journalEntries.filter((e) => e.creditAmount > 0);
        if (debitEntries.length > 1 && creditEntries.length > 1) {
          raise('Journal has multiple debits and multiple credits');
        }

        const {
          date,
          narration,
          isPosted,
          billNumber,
          discountPercentage,
          invoiceId,
        } = journal;

        // first check if this is a past dated entry that needs rebuilding
        const affectedAccounts = new Set(
          journalEntries.map((e) => e.accountId),
        );
        const needsRebuild = new Set<number>();

        for (const accountId of affectedAccounts) {
          // eslint-disable-next-line no-await-in-loop
          if (await this.ledgerService.hasNewerEntries(accountId, date)) {
            needsRebuild.add(accountId);
          }
        }

        // reclaim any sequence drift from deleted tail journals
        await this.syncJournalSequence();

        // insert the journal
        const result = await this.db.run(SQL.insertJournal, {
          date,
          narration,
          isPosted: cast(isPosted),
          billNumber,
          discountPercentage,
          invoiceId: invoiceId ?? null,
          reversesJournalUuid: journal.reversesJournalUuid ?? null,
        });
        const journalId = Number(result.lastInsertRowid);

        // insert all journal entries
        for (const entry of journalEntries) {
          const { debitAmount, accountId, creditAmount } = entry;
          // eslint-disable-next-line no-await-in-loop
          await this.db.run(SQL.insertJournalEntry, {
            journalId,
            debitAmount,
            accountId,
            creditAmount,
          });
        }

        // insert ledger entries
        await this.insertLedgerEntries(journalId, date, journalEntries);
        if (needsRebuild.size > 0) {
          // chronologically rebuild ledger only for accounts that need it
          for (const accountId of needsRebuild) {
            // eslint-disable-next-line no-await-in-loop
            await this.rebuildLedger(accountId);
          }
        }

        return true;
      });
    } catch (error) {
      console.error(
        `Error in insertJournal ${JSON.stringify(journalToBeInserted)}:`,
        error,
      );
      throw error;
    }
  }

  private async rebuildLedger(accountId: number): Promise<void> {
    // docs/derived-state-design.md §6 service cutover: replays the STORED
    // ledger table (not ledger_view) — this write path computes what gets
    // written back into that legacy table, so its input must stay the
    // stored rows, unchanged by the read-side cutover.
    const entries = await this.ledgerService.getStoredLedger(accountId);
    await this.rebuildLedgerFromEntries(accountId, entries);
  }

  /** replays ledger rows in order with fresh running balances (used after stripping journal lines) */
  private async rebuildLedgerFromEntries(
    accountId: number,
    entries: Ledger[],
  ): Promise<void> {
    const { type: accountType } = (await this.db.get<{ type: string }>(
      SQL.accountType,
      [accountId],
    )) as { type: string };

    await this.ledgerService.deleteLedger(accountId);

    let balance = 0;
    let balanceType = JournalService.getDefaultBalanceType(accountType);

    for (const entry of entries) {
      const { date, debit, credit, linkedAccountId, particulars } = entry;

      switch (accountType) {
        case AccountType.Asset:
        case AccountType.Expense:
          balance += debit - credit;
          balanceType = balance >= 0 ? BalanceType.Dr : BalanceType.Cr;
          break;
        case AccountType.Liability:
        case AccountType.Equity:
        case AccountType.Revenue:
          balance += credit - debit;
          balanceType = balance >= 0 ? BalanceType.Cr : BalanceType.Dr;
          break;
        default:
          raise(`Unknown account type: ${accountType}`);
      }

      // eslint-disable-next-line no-await-in-loop
      await this.db.run(SQL.insertLedger, {
        date,
        accountId,
        debit,
        credit,
        balance: Math.abs(balance),
        balanceType,
        particulars,
        linkedAccountId,
      });
    }
  }

  async getJournalIdsByInvoiceId(invoiceId: number): Promise<number[]> {
    const rows = await this.db.all<{ id: number }>(
      SQL.getJournalIdsByInvoiceId,
      [invoiceId],
    );
    return rows.map((r) => r.id);
  }

  /** removes ledger lines whose particulars are `Journal #<id>` for the given ids, then rebuilds each affected account */
  async removeLedgerEffectOfJournals(journalIds: number[]): Promise<void> {
    if (journalIds.length === 0) return;
    const rows = await this.db.all<{ accountId: number }>(
      SQL.getAccountIdsByJournalIdsJson,
      { journalIdsJson: JSON.stringify(journalIds) },
    );
    const accountIds = [...new Set(rows.map((r) => r.accountId))];
    const idSet = new Set(journalIds);

    for (const accountId of accountIds) {
      // Stored table, not ledger_view — same reasoning as rebuildLedger above.
      // eslint-disable-next-line no-await-in-loop
      const entries = await this.ledgerService.getStoredLedger(accountId);
      const filtered = entries.filter((e) => {
        const m = e.particulars.match(/^Journal #(\d+)$/);
        if (!m) return true;
        return !idSet.has(parseInt(m[1], 10));
      });
      // eslint-disable-next-line no-await-in-loop
      await this.rebuildLedgerFromEntries(accountId, filtered);
    }
  }

  async deleteJournalsByIds(journalIds: number[]): Promise<void> {
    if (journalIds.length === 0) return;
    const journalIdsJson = JSON.stringify(journalIds);
    await this.db.run(SQL.deleteJournalEntriesByJournalIdsJson, {
      journalIdsJson,
    });
    await this.db.run(SQL.deleteJournalsByIdsJson, { journalIdsJson });
    await this.syncJournalSequence();
  }

  private static getDefaultBalanceType(accountType: string): BalanceType {
    switch (accountType) {
      case AccountType.Asset:
      case AccountType.Expense:
        return BalanceType.Dr;
      case AccountType.Liability:
      case AccountType.Equity:
      case AccountType.Revenue:
        return BalanceType.Cr;
      default:
        return raise(`Unknown account type: ${accountType}`);
    }
  }

  private async insertLedgerEntries(
    journalId: number,
    date: string,
    entries: JournalEntry[],
  ): Promise<void> {
    // calculate totals for proportional splitting
    const totalDebits = entries.reduce(
      (sum, entry) => sum + entry.debitAmount,
      0,
    );
    const totalCredits = entries.reduce(
      (sum, entry) => sum + entry.creditAmount,
      0,
    );

    for (const entry of entries) {
      const { accountId } = entry;

      // get current balance — from the STORED ledger table, not ledger_view:
      // this seeds the running total this write is about to append to and
      // persist into that same stored table, so it must stay reading the
      // stored table (see LedgerService's class doc comment).
      // eslint-disable-next-line no-await-in-loop
      const currentBalance = await this.ledgerService.getStoredBalance(
        accountId,
      );

      let balance = currentBalance?.balance || 0;
      let balanceType = currentBalance?.balanceType || BalanceType.Dr;

      if (entry.debitAmount > 0) {
        // process each corresponding credit entry
        const creditEntries = entries.filter((e) => e.creditAmount > 0);
        for (const creditEntry of creditEntries) {
          const proportionalDebit =
            (entry.debitAmount * creditEntry.creditAmount) / totalCredits;

          // if current balance type is Dr
          if (balanceType === BalanceType.Dr) {
            balance += proportionalDebit; // add debit to debit balance
          } else {
            // current balance type is Cr
            if (proportionalDebit > balance) {
              // if new debit is bigger, result will be Dr
              balance = proportionalDebit - balance;
              balanceType = BalanceType.Dr;
            } else {
              // if existing credit is bigger, result will be Cr
              balance -= proportionalDebit;
            }
          }

          // eslint-disable-next-line no-await-in-loop
          await this.db.run(SQL.insertLedger, {
            date,
            accountId,
            debit: proportionalDebit,
            credit: 0,
            balance: Math.abs(balance),
            balanceType,
            particulars: `Journal #${journalId}`,
            linkedAccountId: creditEntry.accountId,
          });
        }
      } else if (entry.creditAmount > 0) {
        // process each corresponding debit entry
        const debitEntries = entries.filter((e) => e.debitAmount > 0);
        for (const debitEntry of debitEntries) {
          const proportionalCredit =
            (entry.creditAmount * debitEntry.debitAmount) / totalDebits;

          // if current balance type is Cr
          if (balanceType === BalanceType.Cr) {
            balance += proportionalCredit; // add credit to credit balance
          } else {
            // current balance type is Dr
            if (proportionalCredit > balance) {
              // if new credit is bigger, result will be Cr
              balance = proportionalCredit - balance;
              balanceType = BalanceType.Cr;
            } else {
              // if existing debit is bigger, result will be Dr
              balance -= proportionalCredit;
            }
          }

          // eslint-disable-next-line no-await-in-loop
          await this.db.run(SQL.insertLedger, {
            date,
            accountId,
            debit: 0,
            credit: proportionalCredit,
            balance: Math.abs(balance),
            balanceType,
            particulars: `Journal #${journalId}`,
            linkedAccountId: debitEntry.accountId,
          });
        }
      }
    }
  }

  async updateJournalNarration(
    journalId: number,
    narration: string,
  ): Promise<void> {
    try {
      const { id } =
        (await this.getJournal(journalId)) ??
        raise(`Journal with Id ${journalId} not found`);

      await this.db.run(SQL.updateJournalNarration, {
        journalId: id,
        narration,
      });
    } catch (error) {
      console.error(`Error in updateJournalNarration ${journalId}:`, error);
      throw error;
    }
  }

  async updateJournalInfo(
    journalId: number,
    fields: UpdateJournalFields,
  ): Promise<void> {
    try {
      const journal = await this.getJournal(journalId);
      if (!journal || !journal.id) {
        raise(`Journal with Id ${journalId} not found`);
      }

      const setClauses: string[] = [];
      const params: Record<string, unknown> = { journalId };

      if (has(fields, 'narration')) {
        setClauses.push('narration = @narration');
        params.narration = fields.narration ?? null;
      }
      if (has(fields, 'billNumber')) {
        setClauses.push('billNumber = @billNumber');
        params.billNumber = fields.billNumber ?? null;
      }
      if (has(fields, 'discountPercentage')) {
        setClauses.push('discountPercentage = @discountPercentage');
        params.discountPercentage = fields.discountPercentage ?? null;
      }

      if (setClauses.length === 0) return;

      const sql = `UPDATE journal SET ${setClauses.join(
        ', ',
      )} WHERE id = @journalId`;
      await this.db.run(sql, params);
    } catch (error) {
      console.error(`Error in updateJournalInfo ${journalId}:`, error);
      throw error;
    }
  }

  /**
   * Reverses an existing manual journal by flipping debits and credits.
   * Preserves audit trail and posts a counter-balancing journal.
   */
  async reverseJournal(
    journalId: number,
    options?: { date?: string; narration?: string },
  ): Promise<Journal> {
    try {
      const original = await this.getJournal(journalId);
      if (!original || !original.id) {
        raise(`Journal with Id ${journalId} not found`);
      }

      if (original.invoiceId != null && original.invoiceId > 0) {
        raise(
          'Cannot reverse an invoice-linked journal directly. Please return the invoice instead.',
        );
      }

      const settlement = await this.db
        .get<{ id: number }>(SQL.getSettlementByJournalId, { journalId })
        .catch(() => undefined);
      if (settlement && settlement.id) {
        raise(
          'Cannot reverse a settlement-linked journal directly. Please delete the settlement instead.',
        );
      }

      if (!original.uuid) {
        raise(`Journal with Id ${journalId} has no uuid`);
      }

      const existingReversal = await this.db.get<{ id: number }>(
        SQL.getReversalByOriginalJournalId,
        { uuid: original.uuid },
      );
      if (existingReversal && existingReversal.id) {
        raise('This journal has already been reversed.');
      }

      const reversedEntries: JournalEntry[] = (
        original.journalEntries || []
      ).map(
        (entry) =>
          ({
            accountId: entry.accountId,
            debitAmount: entry.creditAmount,
            creditAmount: entry.debitAmount,
          }) as JournalEntry,
      );

      const supplied = withoutLocalReversalId(
        options?.narration?.trim() || '',
        journalId,
      );
      const narration = supplied || original.narration?.trim() || 'Reversal';
      const date = options?.date || new Date().toISOString();

      const reversalJournal: Journal = {
        id: 0,
        date,
        narration,
        isPosted: true,
        billNumber: original.billNumber,
        discountPercentage: original.discountPercentage,
        invoiceId: undefined,
        reversesJournalUuid: original.uuid,
        journalEntries: reversedEntries,
      };

      const newJournalId = await this.getNextJournalId();
      await this.insertJournal(reversalJournal);
      const inserted = await this.getJournal(newJournalId);
      return inserted && inserted.id ? inserted : reversalJournal;
    } catch (error) {
      console.error(`Error in reverseJournal ${journalId}:`, error);
      throw error;
    }
  }

  /**
   * Deletes an unlinked manual journal and removes its ledger effects.
   * Throws if the journal is linked to an invoice or a commission settlement.
   */
  async deleteManualJournal(journalId: number): Promise<void> {
    try {
      const journal = await this.getJournal(journalId);
      if (!journal || !journal.id) {
        raise(`Journal with Id ${journalId} not found`);
      }

      if (journal.invoiceId != null && journal.invoiceId > 0) {
        raise(
          'Cannot delete an invoice-linked journal. Please delete or return the invoice instead.',
        );
      }

      const settlement = await this.db
        .get<{ id: number }>(SQL.getSettlementByJournalId, { journalId })
        .catch(() => undefined);
      if (settlement && settlement.id) {
        raise(
          'Cannot delete a settlement-linked journal. Please delete the settlement instead.',
        );
      }

      await this.db.transaction(async () => {
        await this.removeLedgerEffectOfJournals([journalId]);
        await this.deleteJournalsByIds([journalId]);
      });
    } catch (error) {
      console.error(`Error in deleteManualJournal ${journalId}:`, error);
      throw error;
    }
  }
}
