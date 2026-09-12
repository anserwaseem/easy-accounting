import { capitalize, get, isEmpty, isNil } from 'lodash';
import {
  BalanceType,
  SectionTypes,
  SingularSections,
  type BalanceSheet,
  type ReportAccount,
  type SingularSection,
  type SectionType,
} from '../../types';
import type { DatabaseDriver } from '../db/driver';
import type { SessionContext } from '../ports';
import { logErrors } from '../errorLogger';
import { ChartService } from './ChartService';
import { AccountService } from './AccountService';
import { LedgerService } from './LedgerService';

const OPENING_BALANCE_PARTICULARS = 'Opening Balance from B/S';
const OPENING_BALANCE_EQUITY_CHART_NAME = 'Equity';
const OPENING_BALANCE_EQUITY_ACCOUNT_NAME = 'Opening Balance Equity';

const SQL = {
  // Facts only — no ledger row. isPosted is inlined as a literal because
  // better-sqlite3 rejects a bound JS boolean; every other write path in this
  // codebase goes through the `cast()` helper for the same reason, but a
  // migration-style literal reads just as clearly for a value that is always
  // the same here.
  insertJournal: `INSERT INTO journal (date, narration, isPosted, invoiceId) VALUES (@date, @narration, 1, NULL)`,
  insertJournalEntry: `INSERT INTO journal_entry (journalId, debitAmount, accountId, creditAmount)
       VALUES (@journalId, @debitAmount, @accountId, @creditAmount)`,
};

/**
 * Platform-free port of src/main/services/Statement.service.ts — identical
 * SQL (via the injected ChartService/AccountService/LedgerService) and
 * behavior, async against the DatabaseDriver, session injected.
 */
@logErrors
export class StatementService {
  private db: DatabaseDriver;

  private session: SessionContext;

  private chartService: ChartService;

  private accountService: AccountService;

  private ledgerService: LedgerService;

  constructor(deps: {
    db: DatabaseDriver;
    session: SessionContext;
    chartService: ChartService;
    accountService: AccountService;
    ledgerService: LedgerService;
  }) {
    this.db = deps.db;
    this.session = deps.session;
    this.chartService = deps.chartService;
    this.accountService = deps.accountService;
    this.ledgerService = deps.ledgerService;
  }

  async saveBalanceSheet(balanceSheet: BalanceSheet): Promise<boolean> {
    try {
      const username = this.session.getUsername() as string;

      await this.db.transaction(async () => {
        const { assets, liabilities, equity } = balanceSheet;
        const date = balanceSheet.date.toISOString();
        const [ASSET, LIABILITY, EQUITY] = SingularSections;
        const [CURRENT, FIXED] = SectionTypes;

        await this.setupLedgers(assets.current, date, ASSET, CURRENT, username);

        await this.setupLedgers(assets.fixed, date, ASSET, FIXED, username);

        await this.setupLedgers(
          liabilities.current,
          date,
          LIABILITY,
          CURRENT,
          username,
        );
        await this.setupLedgers(
          liabilities.fixed,
          date,
          LIABILITY,
          FIXED,
          username,
        );

        await this.setupLedgers(equity.current, date, EQUITY, null, username);
      });

      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  /**
   * Write-path fix for docs/derived-state-design.md §2/§6 (migration 025):
   * `setupLedgers` used to be the only place in the app where a `ledger` row
   * was written with no backing `journal`/`journal_entry` facts at all. From
   * here on every opening-balance row it writes is *also* backed by a real
   * journal, so §2's "ledger is a pure projection of journal + journal_entry"
   * claim holds for every row written going forward (025 backfills the rows
   * that predate this fix).
   *
   * Deliberately NOT routed through `JournalService.insertJournal`: that
   * method's `insertLedgerEntries` does a proportional-split *ledger* write
   * of its own, including a row for the equity (contra) side — which does
   * not exist in today's stored `ledger` table and would be a new,
   * observable behavior change (an "Opening Balance Equity" account
   * appearing in trial balance / account lists) ahead of the view cutover in
   * §6 migration 028. Pre-cutover, the app still reads balances from the
   * stored `ledger` table, so this method keeps writing exactly the same
   * `ledger` row it always has (via `ledgerService.insertLedger`, unchanged
   * below) — stored state for the account's own side is byte-for-byte what
   * it was before this change — and *additionally* inserts the journal fact
   * and both journal_entry rows (including the equity side) directly via
   * SQL. No `ledger` row is written for the equity side pre-cutover; once
   * the view lands, the equity side falls out of `ledger_view` automatically
   * like any other journal, with no further change needed here.
   */
  private async setupLedgers(
    chartsRecord: Record<string, ReportAccount[]>,
    date: string,
    section: NonNullable<SingularSection>,
    sectionType: SectionType,
    username: string,
  ): Promise<void> {
    if (isEmpty(chartsRecord) || isNil(section)) {
      return;
    }

    const equityAccountId = await this.ensureOpeningBalanceEquityAccountId(
      date,
      username,
    );

    const chartIds: Record<string, number | bigint> = {};
    // eslint-disable-next-line no-restricted-syntax
    for (const name of Object.keys(chartsRecord)) {
      const defaultName = ChartService.getChartName('', section, sectionType);
      const isCustomHead = !isEmpty(name) && name !== defaultName;

      const chartName = isCustomHead ? name : defaultName;
      const chartType = capitalize(section);

      // eslint-disable-next-line no-await-in-loop
      const chartId = await this.chartService.findOrCreateChart(
        chartName,
        chartType,
        username,
        date,
        sectionType,
        isCustomHead,
      );
      chartIds[chartName] = chartId;
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const [name, charts] of Object.entries(chartsRecord)) {
      const defaultName = ChartService.getChartName('', section, sectionType);
      const chartName =
        !isEmpty(name) && name !== defaultName ? name : defaultName;

      // eslint-disable-next-line no-restricted-syntax
      for (const chart of charts) {
        const { accountId } =
          // eslint-disable-next-line no-await-in-loop
          await this.accountService.insertAccountIfNotExists({
            name: chart.name,
            headName: chartName,
            code: <string | number | undefined>get(chart, 'code'),
            address: <string | undefined>get(chart, 'address'),
            phone1: <string | undefined>get(chart, 'phone1'),
            phone2: <string | undefined>get(chart, 'phone2'),
            goodsName: <string | undefined>get(chart, 'goodsName'),
            isActive: true,
          });

        const amount = Math.abs(chart.amount);
        const isNegative = chart.amount < 0;

        let debit = 0;
        let credit = 0;
        let balanceType: BalanceType;

        if (section === 'asset' && !isNegative) {
          debit = amount;
          balanceType = BalanceType.Dr;
        } else if (section === 'asset' && isNegative) {
          credit = amount;
          balanceType = BalanceType.Cr;
        } else if (section !== 'asset' && !isNegative) {
          credit = amount;
          balanceType = BalanceType.Cr;
        } else {
          debit = amount;
          balanceType = BalanceType.Dr;
        }

        // eslint-disable-next-line no-await-in-loop
        await this.ledgerService.insertLedger({
          date,
          particulars: OPENING_BALANCE_PARTICULARS,
          accountId,
          debit,
          credit,
          balance: amount,
          balanceType,
        });

        // The journal fact backing the ledger row above (see the comment
        // block on setupLedgers) — the account's own side as stored, plus
        // the balancing side against the system equity account. No ledger
        // row is written for the equity side; see that comment block.
        // eslint-disable-next-line no-await-in-loop
        const journalResult = await this.db.run(SQL.insertJournal, {
          date,
          narration: OPENING_BALANCE_PARTICULARS,
        });
        const journalId = Number(journalResult.lastInsertRowid);

        // eslint-disable-next-line no-await-in-loop
        await this.db.run(SQL.insertJournalEntry, {
          journalId,
          debitAmount: debit,
          accountId,
          creditAmount: credit,
        });
        // eslint-disable-next-line no-await-in-loop
        await this.db.run(SQL.insertJournalEntry, {
          journalId,
          debitAmount: credit,
          accountId: equityAccountId,
          creditAmount: debit,
        });
      }
    }
  }

  /**
   * Finds or creates the system "Opening Balance Equity" account (under an
   * "Equity" chart) used as the balancing side of the journal fact above.
   * Reuses chartService/accountService exactly like the per-row account loop
   * in setupLedgers does, so it shares the same find-or-create semantics —
   * and, since callers already run inside `saveBalanceSheet`'s transaction,
   * the same all-or-nothing rollback behavior — as every other chart/account
   * created here. `discountProfileId` is passed explicitly (unlike the
   * per-row loop above) to avoid the pre-existing insertAccountIfNotExists
   * bug documented in StatementService.test.ts, which only reproduces when
   * that key is missing entirely.
   */
  private async ensureOpeningBalanceEquityAccountId(
    date: string,
    username: string,
  ): Promise<number> {
    await this.chartService.findOrCreateChart(
      OPENING_BALANCE_EQUITY_CHART_NAME,
      OPENING_BALANCE_EQUITY_CHART_NAME,
      username,
      date,
    );

    const { accountId } = await this.accountService.insertAccountIfNotExists({
      name: OPENING_BALANCE_EQUITY_ACCOUNT_NAME,
      headName: OPENING_BALANCE_EQUITY_CHART_NAME,
      code: undefined,
      address: undefined,
      phone1: undefined,
      phone2: undefined,
      goodsName: undefined,
      isActive: true,
      discountProfileId: null,
    });

    return Number(accountId);
  }
}
