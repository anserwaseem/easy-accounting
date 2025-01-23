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
import type { BalanceSheet, InventoryItem, ReportAccount } from 'types';
import {
  isTwoDimensionalArray,
  removeEmptySubarrays,
  toLowerString,
} from './utils';

/**
 * Parses the balance sheet object and returns a parsed BalanceSheet object.
 * @param obj - The balance sheet object to parse.
 * @returns The parsed BalanceSheet object.
 * @throws {Error} - Throws an error if the balance sheet format is invalid or if the date is not found.
 */
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

  if (!isTwoDimensionalArray(obj))
    throw new Error('Invalid balance sheet format');

  const balanceSheet = obj as unknown[][];

  const rawTitles = take(balanceSheet, 3);
  validateTitles(rawTitles);

  const rawAccounts = takeRight(balanceSheet, balanceSheet.length - 3);

  validateAccountHeaders(head(rawAccounts));
  validateSectionsExistence(rawAccounts);

  const transformedAccounts = transformAccounts(rawAccounts);
  // eslint-disable-next-line no-console
  console.table(transformedAccounts);

  parseAccounts(transformedAccounts);

  if (!date) throw new Error('Date not found in Balance Sheet');

  sheet.date = date;
  return sheet;

  /*
   * Private functions
   */

  /**
   * Validates the titles in the given array.
   * @param titles - The array of titles to validate.
   * @throws {Error} - Throws an error if the company name is not found, the title "Balance Sheet" is not found, or if the date format in the balance sheet is invalid.
   */
  function validateTitles(titles: unknown[][]): void {
    map(titles, (title, index) => {
      const titleString = compact(title).join(' ').trim();

      // if (index === 0 && title !== orgName) throw 'Invalid Company Name';
      if (index === 0 && isEmpty(titleString))
        throw new Error('Company Name not found');
      if (index === 1 && titleString.toLowerCase() !== 'balance sheet')
        throw new Error('Title "Balance Sheet" not found');
      if (index === 2) {
        const dateMatch = last(titleString.split(' '))?.match(
          // eslint-disable-next-line no-useless-escape
          /^(0[1-9]|1[0-2]|3[0-1]|[1-9])[-\/.](0[1-9]|1[0-2]|[1-9])[-\/.](\d{4})$/,
        );

        if (!dateMatch)
          throw new Error(
            'Invalid Date Format in Balance Sheet, supported formats: mm/dd/yyyy, mm-dd-yyyy, mm.dd.yyyy',
          );

        const [, day, month, year] = dateMatch;
        date = new Date(`${year}-${month}-${day}`);
      }
    });
  }

  /**
   * Validates the account headers.
   * @param headers - The column headers to validate.
   * @throws {Error} If the column headers are missing, if any column is repeated more than twice,
   * or if any required column is missing.
   */
  function validateAccountHeaders(headers: unknown[] | undefined): void {
    if (!headers) throw new Error('The column headers are missing.');

    const counts = countBy(headers);
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

  /**
   * Validates the sections of the array.
   * @param accounts - The array of accounts data.
   * @throws {Error} If any of the sections are missing.
   */
  function validateSectionsExistence(accounts: unknown[][]): void {
    /**
     * Validates the sections of an array based on the provided criteria.
     * @param sections - An array of sections to validate against.
     * @param columnnIndex - Optional. The index of the column to check within each subarray.
     * @param subarrayIndex - Optional. The index of the subarray to check.
     * @param checkAllSections - Optional. Specifies whether to check all sections or just one.
     * @returns A boolean indicating whether the sections are valid.
     */
    const validateSection = (
      sections: string[],
      columnnIndex?: number,
      subarrayIndex?: number,
      checkAllSections: boolean = false,
    ): boolean => {
      if (subarrayIndex && !accounts[subarrayIndex]) {
        return false;
      }

      const lowerSections = sections.map(toLower);

      if (subarrayIndex === undefined && checkAllSections)
        return accounts.some((subarray) =>
          lowerSections.every((s) =>
            columnnIndex !== undefined
              ? toLowerString(subarray[columnnIndex]).includes(s)
              : subarray.some((e) => toLowerString(e).includes(s)),
          ),
        );

      if (subarrayIndex && !checkAllSections)
        return lowerSections.some((s) =>
          columnnIndex !== undefined
            ? toLowerString(accounts[subarrayIndex][columnnIndex]) === s
            : accounts[subarrayIndex].some((e) => toLowerString(e) === s),
        );

      if (subarrayIndex === undefined && !checkAllSections)
        return lowerSections.some((s) =>
          accounts.some((subarray) =>
            columnnIndex !== undefined
              ? toLowerString(subarray[columnnIndex]) === s
              : subarray.some((e) => toLowerString(e) === s),
          ),
        );

      if (subarrayIndex && checkAllSections)
        return lowerSections.every((s) =>
          columnnIndex !== undefined
            ? toLowerString(accounts[subarrayIndex][columnnIndex]).includes(s)
            : accounts[subarrayIndex].some((e) => toLowerString(e).includes(s)),
        );

      return false;
    };

    /**
     * Checks if the "beforeSection" appears before the "afterSection" in the array.
     * @param beforeSection - The section to check if it appears before.
     * @param afterSection - The section to check if it appears after.
     * @param columnIndex - Optional. The index of the column to compare values in the array.
     * @returns True if the "beforeSection" appears before the "afterSection", false otherwise.
     */
    const isAfter = (
      beforeSection: string,
      afterSection: string,
      columnIndex?: number,
    ): boolean => {
      const beforeIndex = accounts.findIndex((subarray) =>
        columnIndex
          ? toLowerString(subarray[columnIndex]) === toLower(beforeSection)
          : subarray.some((e) => toLowerString(e) === toLower(beforeSection)),
      );
      const afterIndex = accounts.findIndex((subarray) =>
        columnIndex
          ? toLowerString(subarray[columnIndex]) === toLower(afterSection)
          : subarray.some((e) => toLowerString(e) === toLower(afterSection)),
      );

      return (
        beforeIndex !== -1 && afterIndex !== -1 && beforeIndex < afterIndex
      );
    };

    if (!validateSection(['Assets'], 0, 1))
      throw new Error('Section of "Assets" not found');
    if (!validateSection(['Liabilities'], undefined, 1))
      throw new Error('Section of "Liabilities" not found');

    if (!isAfter('Current Assets', 'Non Current Assets', 0))
      throw new Error(
        '"Non Current Assets" should be after "Current Assets" section',
      );
    if (!validateSection(['Current Assets'], 0, 2))
      throw new Error('Section of "Current Assets" not found');
    if (!validateSection(['Non Current Assets', 'Fixed Assets'], 0))
      throw new Error('Section of "Non Current Assets" not found');

    if (!isAfter('Current Liabilities', 'Non Current Liabilities'))
      throw new Error(
        '"Non Current Liabilities" should be after "Current Liabilities" section',
      );
    if (!validateSection(['Current Liabilities'], undefined, 2))
      throw new Error('Section of "Current Liabilities" not found');
    if (!validateSection(['Non Current Liabilities', 'Fixed Liabilities']))
      throw new Error('Section of "Non Current Liabilities" not found');

    if (!isAfter('Non Current Liabilities', 'Equity'))
      throw new Error(
        '"Equity" should be after "Non Current Liabilities" section',
      );
    if (!validateSection(['Equity']))
      throw new Error('Section of "Equity" not found');

    if (!validateSection(['Total', 'Assets'], 0, undefined, true))
      throw new Error('Section of "Total Assets" not found');
    if (
      !validateSection(
        ['Total', 'Liabilities', 'Equity'],
        undefined,
        undefined,
        true,
      )
    )
      throw new Error('Section of "Total Liabilities and Equity" not found');
  }

  /**
   * Transforms the accounts data by rearranging the columns based on unique headers.
   * @param accounts - The array of accounts data.
   * @returns The transformed array of accounts data.
   */
  function transformAccounts(accounts: unknown[][]): unknown[][] {
    if (accounts.length < 2) return accounts;

    const headers = head(accounts);
    const lowerHeaders = map(headers, (e) => toLowerString(e));
    const uniqueHeaders = Array.from(new Set(headers));
    const transformedArray = [uniqueHeaders];

    // look for assets
    for (let i = 1; i < accounts.length; i++) {
      const row = accounts[i];
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
    for (let i = 1; i < accounts.length; i++) {
      const row = accounts[i];
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

  /**
   * Parses the transformed accounts and updates the sheet with the parsed data.
   * @param accounts - The transformed accounts to be parsed.
   * @returns void
   */
  function parseAccounts(accounts: unknown[][]): void {
    type Section = 'assets' | 'liabilities' | 'equity' | null; // need for reading user written sections text, e.g., "Current Assets", "Fixed Liabilities", "Non Current Liabilities" etc. // FUTURE: need to support both singular and plural forms of these sections
    type SectionType = 'current' | 'fixed' | null;

    let currentSection: Section = null;
    let currentSectionType: SectionType = null;

    let totalCurrent = 0;
    let totalFixed = 0;
    let accountHead = '';

    forEach(accounts, (account, accIdx, collection) => {
      // skip headers
      if (accIdx === 0) {
        return;
      }

      const name = head(account) as string;
      const values = tail(account);

      const lowerName = toLower(name);

      switch (lowerName) {
        case 'assets':
          currentSection = 'assets';
          return;
        case 'liabilities':
          currentSection = 'liabilities';
          return;
        case 'equity':
          currentSection = 'equity';
          currentSectionType = 'current';
          return;
        default:
          break;
      }

      // skip if no section is found
      if (!currentSection) return;

      const section = sheet[currentSection];
      const current = section.current as Record<string, ReportAccount[]>;
      const fixed = section.fixed as Record<string, ReportAccount[]>;

      // validate totals
      if (
        lowerName.includes('total') &&
        lowerName.includes('current') &&
        !lowerName.includes('non') &&
        !lowerName.includes('fixed')
      ) {
        sheet[currentSection].totalCurrent = toNumber(head(values));
        if (sheet[currentSection].totalCurrent !== totalCurrent)
          throw new Error(
            `Total Current ${currentSection} do not match. Should be ${totalCurrent}`,
          );
      } else if (
        lowerName.includes('total') &&
        (lowerName.includes('fixed') ||
          (lowerName.includes('non') && lowerName.includes('current')))
      ) {
        sheet[currentSection].totalFixed = toNumber(head(values));
        if (sheet[currentSection].totalFixed !== totalFixed)
          throw new Error(
            `Total Fixed ${currentSection} do not match. Should be ${totalFixed}`,
          );
      } else if (lowerName.includes('total')) {
        // indicating Total Liabilities and Equity
        if (lowerName.includes('equity') && lowerName.includes('liabilities'))
          // LOGIC: toNumber(head(values)) contains 'total liabilities and equity', but we need 'total liabilities' only so subtracting total equity here
          sheet.liabilities.total = toNumber(head(values)) - sheet.equity.total;
        else sheet[currentSection].total = toNumber(head(values));

        // indicating Total Liabilities and Equity
        if (lowerName.includes('equity') && lowerName.includes('liabilities')) {
          if (
            toNumber(head(values)) !== // LOGIC: toNumber(head(values)) contains 'total liabilities and equity' at this moment
            sheet.liabilities.totalFixed +
              sheet.liabilities.totalCurrent +
              sheet.equity.total
          )
            throw new Error(
              `Total liabilities and equity do not match. Should be equal to ${
                sheet.liabilities.totalFixed +
                sheet.liabilities.totalCurrent +
                sheet.equity.total
              }`,
            );
        }
        // indicating equity section where totalCurrent and totalFixed are not used
        else if (
          isNil(sheet[currentSection].totalCurrent) &&
          isNil(sheet[currentSection].totalFixed)
        ) {
          // calculate total amounts for current section of equity and compare with total
          let total = 0;
          forOwn(current, (value) =>
            forEach(value, (acc) => {
              total += acc.amount;
            }),
          );

          if (sheet[currentSection].total !== total)
            throw new Error(`Total ${currentSection} do not match`);
        } else if (sheet[currentSection].total !== totalCurrent + totalFixed)
          throw new Error(
            `Total ${currentSection} do not match. Should be equal to ${
              totalCurrent + totalFixed
            }`,
          );
      }

      // indicates end of equity section i.e., end of balance sheet
      if (currentSection === 'equity' && lowerName.includes('total')) return;

      if (
        isEmpty(values) || // HACK: if section type is not specified, it's taken as 'current'
        (lowerName.includes('current') &&
          !lowerName.includes('non') &&
          !lowerName.includes('fixed'))
      ) {
        currentSectionType = 'current';
        return;
      }

      if (
        lowerName.includes('fixed') ||
        (lowerName.includes('non') && lowerName.includes('current'))
      ) {
        accountHead = '';
        currentSectionType = 'fixed';
        return;
      }

      // if amount is empty, this is a new account head
      if (!head(values)) {
        accountHead = name;
        return;
      }

      const reportAccount: ReportAccount = {
        name,
        amount: toNumber(head(values)),
        ...getOptionalProperties(tail(head(collection)) || [], values),
      };

      switch (currentSectionType) {
        case 'current':
          totalCurrent += reportAccount.amount;
          if (!lowerName.includes('total')) {
            // add to existing account head
            if (current[accountHead]) current[accountHead]?.push(reportAccount);
            // create new account head
            else current[accountHead] = [reportAccount];
          }
          break;
        case 'fixed':
          totalFixed += reportAccount.amount;
          if (!lowerName.includes('total')) {
            // add to existing account head
            if (fixed[accountHead]) fixed[accountHead]?.push(reportAccount);
            // create new account head
            else fixed[accountHead] = [reportAccount];
          }
          break;
        default:
          break;
      }

      // reset
      const nextLowerName = toLower(toString(head(accounts?.at(accIdx + 1))));
      if (nextLowerName === 'liabilities' || nextLowerName === 'equity') {
        currentSection = null;
        currentSectionType = null;
        accountHead = '';
        totalCurrent = 0;
        totalFixed = 0;
      }

      if (currentSection) {
        sheet[currentSection].current = current;
        sheet[currentSection].fixed = fixed;
      }
    });

    function getOptionalProperties(
      headers: unknown[],
      values: unknown[],
    ): Record<string, unknown> {
      const optionalProperties: Record<string, unknown> = {};
      forEach(headers, (header, index) => {
        const lowerHeader = toLowerString(header);
        if (
          lowerHeader !== 'name' &&
          lowerHeader !== 'amount' &&
          !isNil(values[index])
        )
          optionalProperties[lowerHeader] = values[index];
      });
      return optionalProperties;
    }
  }
};

export const parseInventory = (obj: unknown): InventoryItem[] => {
  if (!isTwoDimensionalArray(obj)) {
    throw new Error('Invalid format for inventory');
  }

  const inventoryItems = obj as unknown[][];

  // Skip the header row if it exists
  const startIndex = isHeaderRow(inventoryItems[0]) ? 1 : 0;

  return inventoryItems.slice(startIndex).map((row, index) => {
    if (!Array.isArray(row) || row.length < 2) {
      throw new Error(
        `Invalid row at index ${
          index + startIndex
        }: Expected at least 2 columns`,
      );
    }

    // eslint-disable-next-line one-var
    let name, description, price;

    if (row.length === 2) [name, price] = row;
    if (row.length === 3) [name, description, price] = row;

    if (typeof name === 'number') {
      name = name.toString();
    }

    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error(
        `Invalid name at row ${
          index + startIndex + 1
        }: Name must be a non-empty string`,
      );
    }

    if (
      row.length === 3 &&
      !isNil(description) &&
      typeof description !== 'string'
    ) {
      throw new Error(
        `Invalid description at row ${
          index + startIndex + 1
        }: Description must be a string or empty`,
      );
    }

    const parsedPrice = parseFloat(price as string);
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      throw new Error(
        `Invalid price at row ${
          index + startIndex + 1
        }: Price must be a non-negative number`,
      );
    }

    return {
      name: name.trim(),
      // ...(description && { description: description.trim() }),
      description: 'The Holy Quran',
      price: parsedPrice,
      quantity: 0,
      id: -1,
    };
  });

  function isHeaderRow(row: unknown[]): boolean {
    return row.some(
      (cell) =>
        typeof cell === 'string' &&
        ['name', 'description', 'price'].includes(cell.toLowerCase().trim()),
    );
  }
};

export const parseInvoiceItems = (
  obj: unknown,
): Array<{ name: string; quantity: number }> => {
  if (!isTwoDimensionalArray(obj)) {
    throw new Error('Invalid format for invoice items');
  }

  const invoiceItems = obj as unknown[][];

  // Skip the header row if it exists
  const startIndex = isHeaderRow(invoiceItems[0]) ? 1 : 0;

  return compact(
    invoiceItems.slice(startIndex).map((row, index) => {
      if (!Array.isArray(row) || row.length < 1) {
        throw new Error(
          `Invalid row at index ${
            index + startIndex
          }: Expected at least 1 column`,
        );
      }

      // eslint-disable-next-line prefer-const
      let [name, quantity] = row;

      if (typeof name === 'number') {
        name = name.toString();
      }
      if (isNil(quantity)) {
        // skip this item if no quantity is specified
        return;
      }

      console.log('parsed invoice item', index, row);
      if (typeof name !== 'string' || name.trim() === '') {
        throw new Error(
          `Invalid name at row ${
            index + startIndex + 1
          }: Name must be a non-empty string`,
        );
      }

      if (typeof quantity !== 'number' || quantity < 0) {
        throw new Error(
          `Invalid quantity at row ${
            index + startIndex + 1
          }: Quantity must be a positive number`,
        );
      }

      return {
        name: name.trim(),
        quantity,
      };
    }),
  );

  function isHeaderRow(
    row: unknown[],
    cells = ['name', 'description', 'price'],
  ): boolean {
    return row.some(
      (cell) =>
        typeof cell === 'string' && cells.includes(cell.toLowerCase().trim()),
    );
  }
};
