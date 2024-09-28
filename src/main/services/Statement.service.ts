import type { BalanceSheet, ReportAccount } from 'types';
import type { Database, Statement } from 'better-sqlite3';
import { capitalize, forEach, isEmpty, isNil } from 'lodash';
import { DatabaseService } from './Database.service';
import { store } from '../store';
import { logErrors } from '../errorLogger';

type Section = 'asset' | 'liability' | 'equity';
type SectionType = 'current' | 'fixed' | null;

@logErrors
export class StatementService {
  private db: Database;

  private stmChart!: Statement;

  private stmAccount!: Statement;

  private stmDebitLedger!: Statement;

  private stmCreditLedger!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.initPreparedStatements();
  }

  saveBalanceSheet(balanceSheet: BalanceSheet) {
    try {
      const username = <string>store.get('username');

      const stm = this.db.transaction(
        ({ assets, liabilities, equity }: BalanceSheet) => {
          StatementService.setupLedgers(
            {
              stmChart: this.stmChart,
              stmAccount: this.stmAccount,
              stmDebitLedger: this.stmDebitLedger,
              stmCreditLedger: this.stmCreditLedger,
            },
            assets.current,
            balanceSheet.date.toISOString(),
            'asset',
            'current',
            username,
          );

          StatementService.setupLedgers(
            {
              stmChart: this.stmChart,
              stmAccount: this.stmAccount,
              stmDebitLedger: this.stmDebitLedger,
              stmCreditLedger: this.stmCreditLedger,
            },
            assets.fixed,
            balanceSheet.date.toISOString(),
            'asset',
            'fixed',
            username,
          );

          StatementService.setupLedgers(
            {
              stmChart: this.stmChart,
              stmAccount: this.stmAccount,
              stmDebitLedger: this.stmDebitLedger,
              stmCreditLedger: this.stmCreditLedger,
            },
            liabilities.current,
            balanceSheet.date.toISOString(),
            'liability',
            'current',
            username,
          );
          StatementService.setupLedgers(
            {
              stmChart: this.stmChart,
              stmAccount: this.stmAccount,
              stmDebitLedger: this.stmDebitLedger,
              stmCreditLedger: this.stmCreditLedger,
            },
            liabilities.fixed,
            balanceSheet.date.toISOString(),
            'liability',
            'fixed',
            username,
          );

          StatementService.setupLedgers(
            {
              stmChart: this.stmChart,
              stmAccount: this.stmAccount,
              stmDebitLedger: this.stmDebitLedger,
              stmCreditLedger: this.stmCreditLedger,
            },
            equity.current,
            balanceSheet.date.toISOString(),
            'equity',
            null,
            username,
          );
        },
      );

      stm(balanceSheet);

      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  private static setupLedgers(
    statements: {
      stmChart: Statement;
      stmAccount: Statement;
      stmDebitLedger: Statement;
      stmCreditLedger: Statement;
    },
    chartsRecord: Record<string, ReportAccount[]>,
    date: string,
    section: Section,
    sectionType: SectionType,
    username: string,
  ) {
    if (isEmpty(chartsRecord) || isNil(section)) {
      return;
    }

    const getChartName = (
      name: string,
      inputSection: Section,
      inputSectionType?: SectionType,
    ): string =>
      name ||
      (isNil(inputSectionType)
        ? capitalize(inputSection)
        : `${capitalize(inputSectionType)} ${capitalize(inputSection)}`);

    const chartIds: Record<string, number | bigint> = {};
    forEach(chartsRecord, (_, name) => {
      const chartId = statements.stmChart.run({
        date,
        name: getChartName(name, section, sectionType),
        type: capitalize(section),
        username,
      }).lastInsertRowid;
      chartIds[getChartName(name, section, sectionType)] = chartId;
    });

    forEach(chartsRecord, (charts, name) => {
      forEach(charts, (chart) => {
        const accountId = statements.stmAccount.run({
          chartId: chartIds[getChartName(name, section, sectionType)],
          date,
          name: chart.name,
        }).lastInsertRowid;

        if (section === 'asset') {
          statements.stmDebitLedger.run({
            date,
            particulars: 'Opening Balance from B/S',
            accountId,
            debit: chart.amount,
            balance: chart.amount,
          });
        } else {
          statements.stmCreditLedger.run({
            date,
            particulars: 'Opening Balance from B/S',
            accountId,
            credit: chart.amount,
            balance: chart.amount,
          });
        }
      });
    });
  }

  private initPreparedStatements() {
    this.stmChart = this.db.prepare(`
      INSERT INTO chart (date, name, type, userId)
      VALUES (@date, @name, @type, (SELECT id FROM users WHERE username = @username))
    `);
    this.stmAccount = this.db.prepare(`
      INSERT INTO account (chartId, date, name)
      VALUES (@chartId, @date, @name)
    `);
    this.stmDebitLedger = this.db.prepare(`
      INSERT INTO ledger (date, particulars, accountId, debit, balance, balanceType)
      VALUES (@date, @particulars, @accountId, @debit, @balance, 'Dr')
    `);
    this.stmCreditLedger = this.db.prepare(`
      INSERT INTO ledger (date, particulars, accountId, credit, balance, balanceType)
      VALUES (@date, @particulars, @accountId, @credit, @balance, 'Cr')
    `);
  }
}
