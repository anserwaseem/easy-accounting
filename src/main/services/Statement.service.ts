import { Statement } from 'better-sqlite3';
import { connect, asTransaction } from './Database.service';
import { capitalize, forEach, isEmpty, isNil } from 'lodash';

type Section = 'asset' | 'liability' | 'equity';
type SectionType = 'current' | 'fixed' | null;

export function saveBalanceSheet(
  balanceSheet: BalanceSheet,
  token?: string | null,
) {
  try {
    const db = connect();

    const username = token;
    console.log('inside saveBalanceSheet Account service', username);

    const stmChart = db.prepare(
      `INSERT INTO chart (date, name, type, userId)
      VALUES (@date, @name, @type, (SELECT id FROM users WHERE username = '${username}'))`,
    );
    const stmAccount = db.prepare(
      `INSERT INTO account (chartId, date, name)
      VALUES (@chartId, @date, @name)`,
    );

    const stmDebitLedger = db.prepare(
      `INSERT INTO ledger (date, particulars, accountId, debit, balance, balanceType)
      VALUES (@date, @particulars, @accountId, @debit, @balance, 'Dr')`,
    );
    const stmCreditLedger = db.prepare(
      `INSERT INTO ledger (date, particulars, accountId, credit, balance, balanceType)
      VALUES (@date, @particulars, @accountId, @credit, @balance, 'Cr')`,
    );

    const stm = asTransaction((balanceSheet: BalanceSheet) => {
      const assets = balanceSheet.assets;
      const liabilities = balanceSheet.liabilities;
      const equity = balanceSheet.equity;

      setupLedgers(
        { stmChart, stmAccount, stmDebitLedger, stmCreditLedger },
        assets.current,
        balanceSheet.date.toISOString(),
        'asset',
        'current',
      );

      setupLedgers(
        { stmChart, stmAccount, stmDebitLedger, stmCreditLedger },
        assets.fixed,
        balanceSheet.date.toISOString(),
        'asset',
        'fixed',
      );

      setupLedgers(
        { stmChart, stmAccount, stmDebitLedger, stmCreditLedger },
        liabilities.current,
        balanceSheet.date.toISOString(),
        'liability',
        'current',
      );
      setupLedgers(
        { stmChart, stmAccount, stmDebitLedger, stmCreditLedger },
        liabilities.fixed,
        balanceSheet.date.toISOString(),
        'liability',
        'fixed',
      );

      setupLedgers(
        { stmChart, stmAccount, stmDebitLedger, stmCreditLedger },
        equity.current,
        balanceSheet.date.toISOString(),
        'equity',
      );
    });

    stm(balanceSheet);

    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

const setupLedgers = (
  statements: {
    stmChart: Statement;
    stmAccount: Statement;
    stmDebitLedger: Statement;
    stmCreditLedger: Statement;
  },
  chartsRecord: Record<string, ReportAccount[]>,
  date: string,
  section: Section,
  sectionType?: SectionType,
) => {
  if (isEmpty(chartsRecord) || isNil(section)) {
    return;
  }

  const getChartName = (
    name: string,
    section: Section,
    sectionType?: SectionType,
  ): string =>
    name ||
    (isNil(sectionType)
      ? capitalize(section)
      : `${capitalize(sectionType)} ${capitalize(section)}`);

  const chartIds: Record<string, number | bigint> = {};
  forEach(chartsRecord, (_, name) => {
    // create chart againt each header e.g. "Cash and Bank", "Property, Plant and Equipment" OR "Current Assets", "Fixed Assets" if header is not present
    const chartId = statements.stmChart.run({
      date,
      name: getChartName(name, section, sectionType),
      type: capitalize(section),
    }).lastInsertRowid;
    chartIds[getChartName(name, section, sectionType)] = chartId;
  });

  forEach(chartsRecord, (charts, name) => {
    forEach(charts, (chart) => {
      // create account for each chart
      const accountId = statements.stmAccount.run({
        chartId: chartIds[getChartName(name, section, sectionType)],
        date,
        name: chart.name,
      }).lastInsertRowid;

      if (section === 'asset') {
        // add entry to debit ledger
        statements.stmDebitLedger.run({
          date,
          particulars: 'Opening Balance from B/S',
          accountId,
          debit: chart.amount,
          balance: chart.amount,
        });
      } else {
        // add entry to credit ledger
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
};
