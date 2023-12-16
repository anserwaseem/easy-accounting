import { BalanceSheet, ReportAccount } from './types';
import {
  compact,
  countBy,
  filter,
  forEach,
  forOwn,
  head,
  isEmpty,
  isNil,
  keys,
  last,
  map,
  tail,
  take,
  takeRight,
  toLower,
  toNumber,
  toString,
} from 'lodash';
import { isTwoDimensionalArray, removeEmptySubarrays } from './utils';

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
  validateSectionsExistence(accounts);

  const transformedAccounts = transformAccounts(accounts);
  console.log('transformedAccounts', transformedAccounts);

  parseAccounts(transformedAccounts);

  if (!date) throw 'Date not found in Balance Sheet';

  sheet.date = date;
  console.log('sheet', sheet);
  return sheet;

  /*
   * Private functions
   */

  function validateTitles(titles: unknown[][]): void {
    map(titles, (title, index) => {
      const titleString = compact(title).join(' ').trim();

      // if (index === 0 && title !== orgName) throw 'Invalid Company Name';
      if (index === 0 && isEmpty(titleString)) throw 'Company Name not found';
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

    const requiredColumns = ['Name', 'Amount'];
    const missingColumns = requiredColumns.filter(
      (column) => counts[column] !== 2,
    );

    if (missingColumns.length > 0)
      throw new Error(
        `The following columns are missing: ${missingColumns.join(', ')}`,
      );
  }

  function validateSectionsExistence(arr: unknown[][]): void {
    const validateSection = (
      section: string | string[],
      columnnIndex: number,
      subarrayIndex?: number,
      checkAllSections: boolean = false,
    ): boolean => {
      if (subarrayIndex && !arr[subarrayIndex]) {
        return false;
      }

      const sections = Array.isArray(section)
        ? section.map(toLower)
        : [toLower(section)];

      if (!subarrayIndex && checkAllSections)
        return arr.every((subarray) =>
          sections.every((c) =>
            toLower(toString(subarray[columnnIndex])).includes(c),
          ),
        );

      if (subarrayIndex && !checkAllSections)
        return sections.some(
          (c) => c === toLower(toString(arr[subarrayIndex][columnnIndex])),
        );

      if (!subarrayIndex && checkAllSections)
        return arr.some((subarray) =>
          sections.every((c) =>
            toLower(toString(subarray[columnnIndex])).includes(c),
          ),
        );

      return arr.some((subarray) =>
        sections.some((c) => c === toLower(toString(subarray[columnnIndex]))),
      );
    };

    const isAfter = (
      beforeSection: string,
      afterSection: string,
      columnIndex: number,
    ): boolean => {
      const beforeIndex = arr.findIndex(
        (subarray) =>
          toLower(toString(subarray[columnIndex])) === toLower(beforeSection),
      );
      const afterIndex = arr.findIndex(
        (subarray) =>
          toLower(toString(subarray[columnIndex])) === toLower(afterSection),
      );

      return (
        beforeIndex !== -1 && afterIndex !== -1 && beforeIndex < afterIndex
      );
    };

    if (!validateSection('Assets', 0, 1))
      throw new Error('Section of "Assets" not found');
    if (!validateSection('Liabilities', 2, 1))
      throw new Error('Section of "Liabilities" not found');

    if (!isAfter('Current Assets', 'Non Current Assets', 0))
      throw new Error(
        '"Non Current Assets" should be after "Current Assets" section',
      );
    if (!validateSection('Current Assets', 0, 2))
      throw new Error('Section of "Current Assets" not found');
    if (!validateSection(['Non Current Assets', 'Fixed Assets'], 0))
      throw new Error('Section of "Non Current Assets" not found');

    if (!isAfter('Current Liabilities', 'Non Current Liabilities', 2))
      throw new Error(
        '"Non Current Liabilities" should be after "Current Liabilities" section',
      );
    if (!validateSection('Current Liabilities', 2, 2))
      throw new Error('Section of "Current Liabilities" not found');
    if (!validateSection(['Non Current Liabilities', 'Fixed Liabilities'], 2))
      throw new Error('Section of "Non Current Liabilities" not found');

    if (!isAfter('Non Current Liabilities', 'Equity', 2))
      throw new Error(
        '"Equity" should be after "Non Current Liabilities" section',
      );
    if (!validateSection('Equity', 2))
      throw new Error('Section of "Equity" not found');

    if (!validateSection('Total Assets', 0))
      throw new Error('Section of "Total Assets" not found');
    if (
      !validateSection(['Total', 'Liabilities', 'Equity'], 2, undefined, true)
    )
      throw new Error('Section of "Total Liabilities and Equity" not found');
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
      if (accIdx === 0) return; // skip headers

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
          throw `Total Current ${currentSection} do not match. Should be ${totalCurrent}`;
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
          throw `Total Fixed ${currentSection} do not match. Should be ${totalFixed}`;
        }
      } else if (lowerName.includes('total')) {
        console.log(
          'calculate totals: total',
          currentSection,
          lowerName,
          values,
        );
        console.log(
          'totalll',
          sheet[currentSection],
          sheet[currentSection].total,
          lowerName,
          toNumber(head(values)),
          totalCurrent,
          totalFixed,
        );

        // indicating Total Liabilities and Equity
        if (lowerName.includes('equity') && lowerName.includes('liabilities'))
          // LOGIC: toNumber(head(values)) contains 'total liabilities and equity', but we need 'total liabilities' only so subtracting total equity here
          sheet['liabilities'].total =
            toNumber(head(values)) - sheet['equity'].total;
        else sheet[currentSection].total = toNumber(head(values));

        // indicating Total Liabilities and Equity
        if (lowerName.includes('equity') && lowerName.includes('liabilities')) {
          console.log(' if total', toNumber(head(values)), sheet);
          if (
            toNumber(head(values)) !== // LOGIC: toNumber(head(values)) contains 'total liabilities and equity' at this moment
            sheet['liabilities'].totalFixed +
              sheet['liabilities'].totalCurrent +
              sheet['equity'].total
          )
            throw `Total liabilities and equity do not match. Should be equal to ${
              sheet['liabilities'].totalFixed +
              sheet['liabilities'].totalCurrent +
              sheet['equity'].total
            }`;
        }
        // indicating equity section where totalCurrent and totalFixed are not used
        else if (
          isNil(sheet[currentSection].totalCurrent) &&
          isNil(sheet[currentSection].totalFixed)
        ) {
          // calculate total amounts for current section of equity and compare with total
          let total = 0;
          forOwn(current, (value) => {
            for (const account of value) {
              total += account.amount;
            }
          });

          console.log(
            'else if total',
            sheet[currentSection].total,
            totalCurrent,
            totalFixed,
            total,
          );
          if (sheet[currentSection].total !== total)
            throw `Total ${currentSection} do not match`;
        } else if (sheet[currentSection].total !== totalCurrent + totalFixed) {
          console.log(
            'else total',
            sheet[currentSection].total,
            totalCurrent,
            totalFixed,
          );
          throw `Total ${currentSection} do not match. Should be equal to ${
            totalCurrent + totalFixed
          }`;
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
