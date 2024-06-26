import type { BalanceSheet, ReportAccount } from 'types';
import { capitalize, forEach, isEmpty, isNil } from 'lodash';
import { Statement } from 'better-sqlite3';
import { connect } from './Database.service';
import { store } from '../store';

type Section = 'asset' | 'liability' | 'equity';
type SectionType = 'current' | 'fixed' | null;

export function saveBalanceSheet(balanceSheet: BalanceSheet) {
  try {
    const db = connect();

    const username = store.get('username');

    const stmChart = db.prepare(
      ` INSERT INTO chart (date, name, type, userId)
        VALUES (@date, @name, @type, (SELECT id FROM users WHERE username = '${username}'))`,
    );
    const stmAccount = db.prepare(
      ` INSERT INTO account (chartId, date, name)
        VALUES (@chartId, @date, @name)`,
    );

    const stmDebitLedger = db.prepare(
      ` INSERT INTO ledger (date, particulars, accountId, debit, balance, balanceType)
        VALUES (@date, @particulars, @accountId, @debit, @balance, 'Dr')`, // TODO: update balanceType below based on balance
    );
    const stmCreditLedger = db.prepare(
      ` INSERT INTO ledger (date, particulars, accountId, credit, balance, balanceType)
        VALUES (@date, @particulars, @accountId, @credit, @balance, 'Cr')`, // TODO: update balanceType below based on balance
    );

    const stm = db.transaction(
      ({ assets, liabilities, equity }: BalanceSheet) => {
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
      },
    );

    stm(balanceSheet);

    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    return false;
  }
}

function setupLedgers(
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
          balance: chart.amount, // TODO: update balance (ideally by fetching if (last balance from ledger) => update by adding/subtracting the amount based on its balanceType, else => set the amount as balance)
          // balanceType:
        });
      } else {
        // add entry to credit ledger
        statements.stmCreditLedger.run({
          date,
          particulars: 'Opening Balance from B/S',
          accountId,
          credit: chart.amount,
          balance: chart.amount, // TODO: update balance (ideally by fetching if (last balance from ledger) => update by adding/subtracting the amount based on its balanceType, else => set the amount as balance)
          // balanceType:
        });
      }
    });
  });
}
