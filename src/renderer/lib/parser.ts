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
    equity: {},
  };

  if (!isTwoDimensionalArray(obj)) throw 'Invalid balance sheet format';

  const balanceSheet = obj as unknown[][];

  const titles = take(balanceSheet, 3);

  validateTitles(titles);

  const accounts = takeRight(balanceSheet, balanceSheet.length - 3);

  validateAccountHeaders(head(accounts));

  const transformedAccounts = transformAccounts(accounts);
  console.log('transformedAccounts', transformedAccounts);

  type section = 'assets' | 'liabilities' | 'equity' | null;
  type sectionType = 'current' | 'fixed' | null;

  let currentSection: section = null;
  let currentSectionType: sectionType = null;
  let accountHead = '';

  map(transformedAccounts, (account, index) => {
    //TODO: parse accounts
    if (index === 0) return;

    const name = head(account) as string;
    const values = tail(account);

    if (toLower(name) === 'assets') {
      currentSection = 'assets';
      return;
    } else if (toLower(name) === 'liabilities') {
      currentSection = 'liabilities';
      return;
    } else if (toLower(name) === 'equity') {
      currentSection = 'equity';
      return;
    }

    if (!currentSection) return;

    const section = sheet[currentSection];
    const current = section.current as Record<string, ReportAccount[]>;
    const fixed = section.fixed as Record<string, ReportAccount[]>;

    if (currentSection === 'assets') {
      if (name.includes('current') || isEmpty(values)) {
        currentSectionType = 'current';
        return;
      } else if (name.includes('fixed')) {
        currentSectionType = 'fixed';
        return;
      }

      // if amount is empty, this is a new account head
      if (isEmpty(head(values))) {
        accountHead = name;
        return;
      }

      const account: ReportAccount = {
        name,
        amount: toNumber(head(values)),
        // add other properties here
      };

      if (currentSectionType === 'current') {
        if (current[accountHead]) current[accountHead]?.push(account);
        else current[accountHead] = [account];
      } else if (currentSectionType === 'fixed') {
        if (fixed[accountHead]) fixed[accountHead]?.push(account);
        else fixed[accountHead] = [account];
      }

      // reset
      if (
        toLower(toString(head(transformedAccounts?.at(index + 1)))) ===
        'liabilities'
      ) {
        currentSection = null;
        currentSectionType = null;
        accountHead = '';
      }
    }
  });

  if (!date) throw 'Date not found in Balance Sheet';

  sheet.date = date;
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
};
