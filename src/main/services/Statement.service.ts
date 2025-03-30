import type {
  BalanceSheet,
  ReportAccount,
  SingularSection,
  SectionType,
} from 'types';
import type { Database } from 'better-sqlite3';
import { capitalize, forEach, get, isEmpty, isNil } from 'lodash';
import { BalanceType, SectionTypes, SingularSections } from '../../types';
import { DatabaseService } from './Database.service';
import { ChartService } from './Chart.service';
import { AccountService } from './Account.service';
import { store } from '../store';
import { logErrors } from '../errorLogger';
import { LedgerService } from './Ledger.service';

@logErrors
export class StatementService {
  private db: Database;

  private chartService: ChartService;

  private accountService: AccountService;

  private ledgerService: LedgerService;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.chartService = new ChartService();
    this.accountService = new AccountService();
    this.ledgerService = new LedgerService();
  }

  saveBalanceSheet(balanceSheet: BalanceSheet) {
    try {
      const username = <string>store.get('username');

      const stm = this.db.transaction(
        ({ assets, liabilities, equity }: BalanceSheet) => {
          const date = balanceSheet.date.toISOString();
          const [ASSET, LIABILITY, EQUITY] = SingularSections;
          const [CURRENT, FIXED] = SectionTypes;

          this.setupLedgers(assets.current, date, ASSET, CURRENT, username);

          this.setupLedgers(assets.fixed, date, ASSET, FIXED, username);

          this.setupLedgers(
            liabilities.current,
            date,
            LIABILITY,
            CURRENT,
            username,
          );
          this.setupLedgers(
            liabilities.fixed,
            date,
            LIABILITY,
            FIXED,
            username,
          );

          this.setupLedgers(equity.current, date, EQUITY, null, username);
        },
      );

      stm(balanceSheet);

      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  private setupLedgers(
    chartsRecord: Record<string, ReportAccount[]>,
    date: string,
    section: NonNullable<SingularSection>,
    sectionType: SectionType,
    username: string,
  ) {
    if (isEmpty(chartsRecord) || isNil(section)) {
      return;
    }

    const chartIds: Record<string, number | bigint> = {};
    forEach(chartsRecord, (_, name) => {
      const defaultName = ChartService.getChartName('', section, sectionType);
      const isCustomHead = !isEmpty(name) && name !== defaultName;

      const chartName = isCustomHead ? name : defaultName;
      const chartType = capitalize(section);

      const chartId = this.chartService.findOrCreateChart(
        chartName,
        chartType,
        username,
        date,
        sectionType,
        isCustomHead,
      );
      chartIds[chartName] = chartId;
    });

    forEach(chartsRecord, (charts, name) => {
      const defaultName = ChartService.getChartName('', section, sectionType);
      const chartName =
        !isEmpty(name) && name !== defaultName ? name : defaultName;

      forEach(charts, (chart) => {
        const { accountId } = this.accountService.insertAccountIfNotExists({
          name: chart.name,
          headName: chartName,
          code: <string | number | undefined>get(chart, 'code'),
          address: <string | undefined>get(chart, 'address'),
          phone1: <string | undefined>get(chart, 'phone1'),
          phone2: <string | undefined>get(chart, 'phone2'),
          goodsName: <string | undefined>get(chart, 'goodsName'),
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

        this.ledgerService.insertLedger({
          date,
          particulars: 'Opening Balance from B/S',
          accountId,
          debit,
          credit,
          balance: amount,
          balanceType,
        });
      });
    });
  }
}
