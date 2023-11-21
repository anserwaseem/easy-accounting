import { BalanceSheet, ReportAccount } from './types';
import {
  compact,
  constant,
  countBy,
  every,
  filter,
  find,
  findIndex,
  forEach,
  forOwn,
  get,
  head,
  isArray,
  isEmpty,
  isNil,
  isTypedArray,
  keys,
  last,
  map,
  set,
  tail,
  take,
  takeRight,
  toArray,
  toLength,
  toLower,
  toNumber,
  toString,
} from 'lodash';
import {
  firstDuplicateIndex,
  isTwoDimensionalArray,
  removeEmptySubarrays,
} from './utils';

export const parseBalanceSheet = (obj: unknown): BalanceSheet => {
  let date: Date | null = null;
  const sheet: BalanceSheet = {
    date: new Date(),
    assets: {
      current: {},
      totalCurrent: 0,
      fixed: {},
      totalFixed: 0,
      total: 0,
    },
    liabilities: {
      current: {},
      totalCurrent: 0,
      fixed: {},
      totalFixed: 0,
      total: 0,
    },
    equity: {
      current: {},
      total: 0,
      totalCurrent: undefined,
      fixed: undefined,
      totalFixed: undefined,
    },
  };

  if (!isTwoDimensionalArray(obj)) throw 'Invalid balance sheet format';

  const balanceSheet = obj as unknown[][];

  const titles = take(balanceSheet, 3);

  validateTitles(titles);

  const accounts = takeRight(balanceSheet, balanceSheet.length - 3);

  validateAccountHeaders(head(accounts));

  const transformedAccounts = transformAccounts(accounts);
  console.log('transformedAccounts', transformedAccounts);

  parseAccounts(transformedAccounts);

  if (!date) throw 'Date not found in Balance Sheet';

  sheet.date = date;
  console.log('sheet', sheet);
  return sheet;

  // private functions

  function validateTitles(titles: unknown[][]): void {
    map(titles, (title, index) => {
      const titleString = compact(title).join(' ').trim();

      // if (index === 0 && title !== orgName) throw 'Invalid Company Name';
      if (index === 1 && titleString.toLowerCase() !== 'balance sheet')
        throw 'Title "Balance Sheet" not found';
      if (index === 2) {
        const dateMatch = last(titleString.split(' '))?.match(
          /^(0[1-9]|1[0-2]|3[0-1]|[1-9])[-\/.](0[1-9]|1[0-2]|[1-9])[-\/.](\d{4})$/,
        );

        if (!dateMatch)
          throw 'Invalid Date Format in Balance Sheet, supported formats: mm/dd/yyyy, mm-dd-yyyy, mm.dd.yyyy';

        const [, day, month, year] = dateMatch;
        date = new Date(`${year}-${month}-${day}`);
      }
    });
  }

  function validateAccountHeaders(array: unknown[] | undefined): void {
    if (!array) throw new Error('The column headers are missing.');

    const counts = countBy(array);
    const repeatedColumns = filter(
      keys(counts),
      (column) => counts[column] > 2,
    );

    if (!isEmpty(repeatedColumns))
      throw new Error(
        `The following columns are repeated more than twice: ${repeatedColumns.join(
          ', ',
        )}.`,
      );

    if (firstDuplicateIndex(map(array, (e) => toLower(toString(e)))) !== 0)
      throw new Error('The first repeating column must be "Name".');
  }

  function transformAccounts(inputArray: unknown[][]): unknown[][] {
    if (inputArray.length < 2) return inputArray;

    const headers = head(inputArray);
    const lowerHeaders = map(headers, (e) => toLower(toString(e)));
    const uniqueHeaders = Array.from(new Set(headers));
    const transformedArray = [uniqueHeaders];

    // look for assets
    for (let i = 1; i < inputArray.length; i++) {
      const row = inputArray[i];
      const newRow = Array.from({ length: uniqueHeaders.length }, (_, j) => {
        const columnIndex = headers?.indexOf(uniqueHeaders[j]);

        return columnIndex !== undefined &&
          columnIndex !== -1 &&
          columnIndex < (lowerHeaders?.lastIndexOf('name') || 0)
          ? row[columnIndex]
          : null;
      });
      transformedArray.push(newRow);
    }

    // look for liabilities and equity
    for (let i = 1; i < inputArray.length; i++) {
      const row = inputArray[i];
      const newRow = Array.from({ length: uniqueHeaders.length }, (_, j) => {
        const columnIndex = headers?.lastIndexOf(uniqueHeaders[j]);
        return columnIndex !== undefined &&
          columnIndex !== -1 &&
          columnIndex >= (lowerHeaders?.lastIndexOf('name') || 0)
          ? row[columnIndex]
          : null;
      });
      transformedArray.push(newRow);
    }

    return removeEmptySubarrays(transformedArray);
  }

  function parseAccounts(transformedAccounts: unknown[][]): void {
    type Section = 'assets' | 'liabilities' | 'equity' | null;
    type SectionType = 'current' | 'fixed' | null;
    type SectionTotal = 'totalCurrent' | 'totalFixed' | 'total' | null;

    let currentSection: Section = null;
    let currentSectionType: SectionType = null;

    let sectionTotal: SectionTotal = null;
    let totalCurrent = 0;
    let totalFixed = 0;
    let accountHead = '';

    forEach(transformedAccounts, (account, accIdx) => {
      if (accIdx === 0) return;

      const name = head(account) as string;
      const values = tail(account);

      const lowerName = toLower(name);

      console.log('name', name);
      console.log('values', values);

      if (lowerName === 'assets') {
        currentSection = 'assets';
        return;
      } else if (lowerName === 'liabilities') {
        currentSection = 'liabilities';
        return;
      } else if (lowerName === 'equity') {
        currentSection = 'equity';
        currentSectionType = 'current';
        return;
      }

      console.log('currentSection', currentSection);
      if (!currentSection) return;

      const section = sheet[currentSection];
      const current = section.current as Record<string, ReportAccount[]>;
      const fixed = section.fixed as Record<string, ReportAccount[]>;

      if (
        lowerName.includes('total') &&
        lowerName.includes('current') &&
        !lowerName.includes('non') &&
        !lowerName.includes('fixed')
      ) {
        console.log('calculate totals: totalCurrent', lowerName, values);
        sheet[currentSection].totalCurrent = toNumber(head(values));
        if (sheet[currentSection].totalCurrent !== totalCurrent) {
          console.log(
            'totalCurrent',
            sheet[currentSection].totalCurrent,
            totalCurrent,
          );
          throw `Total Current ${currentSection} do not match`;
        }
      } else if (
        lowerName.includes('total') &&
        (lowerName.includes('fixed') ||
          (lowerName.includes('current') && lowerName.includes('non')))
      ) {
        console.log('calculate totals: totalFixed', lowerName, values);
        sheet[currentSection].totalFixed = toNumber(head(values));
        if (sheet[currentSection].totalFixed !== totalFixed) {
          console.log(
            'totalFixed',
            sheet[currentSection].totalFixed,
            totalFixed,
          );
          throw `Total Fixed ${currentSection} do not match`;
        }
      } else if (lowerName.includes('total')) {
        console.log(
          'calculate totals: total',
          currentSection,
          lowerName,
          values,
        );
        if (lowerName.includes('equity') && sheet[currentSection].total !== 0)
          // HACK: equity total is already set
          sheet['liabilities'].total = toNumber(head(values));
        else sheet[currentSection].total = toNumber(head(values));

        if (sheet[currentSection].total !== totalCurrent + totalFixed) {
          console.log(
            'total',
            sheet[currentSection].total,
            totalCurrent,
            totalFixed,
          );
          // throw `Total ${currentSection} do not match`;
        }
      }

      if (currentSection === 'equity' && lowerName.includes('total')) return; // indicates end of equity section

      if (
        isEmpty(values) || // HACK: if section type is not specified, it's taken as 'current'
        (lowerName.includes('current') &&
          !lowerName.includes('non') &&
          !lowerName.includes('fixed'))
      ) {
        currentSectionType = 'current';
        return;
      } else if (
        lowerName.includes('fixed') ||
        (lowerName.includes('current') && lowerName.includes('non'))
      ) {
        accountHead = '';
        currentSectionType = 'fixed';
        return;
      }

      console.log('currentSectionType', currentSectionType);
      console.log('sectionTotal', sectionTotal);

      // if amount is empty, this is a new account head
      if (!head(values)) {
        accountHead = name;
        console.log('accountHead inside', accountHead);
        return;
      }
      console.log('accountHead', accountHead);

      const reportAccount: ReportAccount = {
        name,
        amount: toNumber(head(values)),
        // add other properties here
      };
      console.log('account', account);

      console.log('currentSectionType', currentSectionType);
      if (currentSectionType === 'current') {
        totalCurrent += reportAccount.amount;
        console.log('current[accountHead]', totalCurrent, current[accountHead]);
        if (current[accountHead]) current[accountHead]?.push(reportAccount);
        else current[accountHead] = [reportAccount];
      } else if (currentSectionType === 'fixed') {
        totalFixed += reportAccount.amount;
        console.log('fixed[accountHead]', totalFixed, fixed[accountHead]);
        if (fixed[accountHead]) fixed[accountHead]?.push(reportAccount);
        else fixed[accountHead] = [reportAccount];
      }

      // reset
      const nextLowerName = toLower(
        toString(head(transformedAccounts?.at(accIdx + 1))),
      );
      console.log('reset: ', nextLowerName);
      if (nextLowerName === 'liabilities' || nextLowerName === 'equity') {
        currentSection = null;
        currentSectionType = null;
        accountHead = '';
        totalCurrent = 0;
        totalFixed = 0;
      }

      console.log('currentSection', currentSection, current, fixed);
      if (currentSection) {
        sheet[currentSection].current = current;
        sheet[currentSection].fixed = fixed;
      }
    });
  }
};
