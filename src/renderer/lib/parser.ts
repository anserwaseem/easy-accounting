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
import {
  BalanceType,
  Sections,
  SectionTypes,
  type BalanceSheet,
  type InventoryItem,
  type ReportAccount,
  type Section,
  type SectionType,
} from 'types';
import {
  getFixedNumber,
  isTwoDimensionalArray,
  removeEmptySubarrays,
  toLowerString,
  raise,
  parseCurrencyLikeAmount,
} from './utils';

// #region balance sheet

/**
 * Parses the balance sheet object and returns a parsed BalanceSheet object.
 * @param obj - The balance sheet object to parse.
 * @returns The parsed BalanceSheet object.
 * @throws {Error} - Throws an error if the balance sheet format is invalid or if the date is not found.
 */
export const parseBalanceSheet = (obj: unknown): BalanceSheet => {
  let date: Date | null = null; // set in validateTitles function
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

  if (!isTwoDimensionalArray(obj)) raise('Invalid balance sheet format');

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

  const validDate = date ?? raise('Date not found in Balance Sheet');

  sheet.date = validDate;
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
      if (index === 0 && isEmpty(titleString)) raise('Company Name not found');
      if (index === 1 && titleString.toLowerCase() !== 'balance sheet')
        raise('Title "Balance Sheet" not found');
      if (index === 2) {
        const dateMatch =
          last(titleString.split(' '))?.match(
            // eslint-disable-next-line no-useless-escape
            /^(0[1-9]|1[0-2]|3[0-1]|[1-9])[-\/.](0[1-9]|1[0-2]|[1-9])[-\/.](\d{4})$/,
          ) ??
          raise(
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
    const validHeaders = headers ?? raise('The column headers are missing.');

    const counts = countBy(validHeaders);
    const repeatedColumns = filter(
      keys(counts),
      (column) => counts[column] > 2,
    );

    if (!isEmpty(repeatedColumns))
      raise(
        `The following columns are repeated more than twice: ${repeatedColumns.join(
          ', ',
        )}.`,
      );

    const requiredColumns = ['Name', 'Amount'];
    const missingColumns = requiredColumns.filter(
      (column) => counts[column] !== 2,
    );

    if (missingColumns.length > 0)
      raise(`The following columns are missing: ${missingColumns.join(', ')}`);
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
      raise('Section of "Assets" not found');
    if (!validateSection(['Liabilities'], undefined, 1))
      raise('Section of "Liabilities" not found');

    if (!isAfter('Current Assets', 'Non Current Assets', 0))
      raise('"Non Current Assets" should be after "Current Assets" section');
    if (!validateSection(['Current Assets'], 0, 2))
      raise('Section of "Current Assets" not found');
    if (!validateSection(['Non Current Assets', 'Fixed Assets'], 0))
      raise('Section of "Non Current Assets" not found');

    if (!isAfter('Current Liabilities', 'Non Current Liabilities'))
      raise(
        '"Non Current Liabilities" should be after "Current Liabilities" section',
      );
    if (!validateSection(['Current Liabilities'], undefined, 2))
      raise('Section of "Current Liabilities" not found');
    if (!validateSection(['Non Current Liabilities', 'Fixed Liabilities']))
      raise('Section of "Non Current Liabilities" not found');

    if (!isAfter('Non Current Liabilities', 'Equity'))
      raise('"Equity" should be after "Non Current Liabilities" section');
    if (!validateSection(['Equity'])) raise('Section of "Equity" not found');

    if (!validateSection(['Total', 'Assets'], 0, undefined, true))
      raise('Section of "Total Assets" not found');
    if (
      !validateSection(
        ['Total', 'Liabilities', 'Equity'],
        undefined,
        undefined,
        true,
      )
    )
      raise('Section of "Total Liabilities and Equity" not found');
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

      const [ASSETS, LIABILITIES, EQUITY] = Sections;
      const [CURRENT, FIXED] = SectionTypes;

      switch (lowerName) {
        case ASSETS:
          currentSection = ASSETS;
          return;
        case LIABILITIES:
          currentSection = LIABILITIES;
          return;
        case EQUITY:
          currentSection = EQUITY;
          currentSectionType = CURRENT;
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
          raise(
            `Total Current ${currentSection} do not match. Should be ${totalCurrent}`,
          );
      } else if (
        lowerName.includes('total') &&
        (lowerName.includes('fixed') ||
          (lowerName.includes('non') && lowerName.includes('current')))
      ) {
        sheet[currentSection].totalFixed = toNumber(head(values));
        if (sheet[currentSection].totalFixed !== totalFixed)
          raise(
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
            raise(
              `Total liabilities and equity ${toNumber(
                head(values),
              )} do not match. Should be equal to ${
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

          if (
            getFixedNumber(sheet[currentSection].total) !==
            getFixedNumber(total)
          )
            raise(`Total ${currentSection} do not match`);
        } else if (
          getFixedNumber(sheet[currentSection].total) !==
          getFixedNumber(totalCurrent + totalFixed)
        )
          raise(
            `Total ${currentSection} ${getFixedNumber(
              sheet[currentSection].total,
            )} do not match. Should be equal to ${getFixedNumber(
              totalCurrent + totalFixed,
            )}`,
          );
      }

      // indicates end of equity section i.e., end of balance sheet
      if (currentSection === EQUITY && lowerName.includes('total')) return;

      if (
        isEmpty(values) || // HACK: if section type is not specified, it's taken as 'current'
        (lowerName.includes('current') &&
          !lowerName.includes('non') &&
          !lowerName.includes('fixed'))
      ) {
        currentSectionType = CURRENT;
        return;
      }

      if (
        lowerName.includes('fixed') ||
        (lowerName.includes('non') && lowerName.includes('current'))
      ) {
        accountHead = '';
        currentSectionType = FIXED;
        return;
      }

      // if no amount is specified, treat this as a new account head
      if (isNil(head(values))) {
        accountHead = name;
        return;
      }

      const reportAccount: ReportAccount = {
        name,
        amount: toNumber(head(values)),
        ...getOptionalProperties(tail(head(collection)) || [], values),
      };

      switch (currentSectionType) {
        case CURRENT:
          totalCurrent += reportAccount.amount;
          if (!lowerName.includes('total')) {
            // add to existing account head
            if (current[accountHead]) current[accountHead]?.push(reportAccount);
            // create new account head
            else current[accountHead] = [reportAccount];
          }
          break;
        case FIXED:
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
      if (nextLowerName === LIABILITIES || nextLowerName === EQUITY) {
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

// #endregion

// #region inventory

export const parseInventory = (obj: unknown): InventoryItem[] => {
  if (!isTwoDimensionalArray(obj)) raise('Invalid format for inventory');

  const inventoryItems = obj as unknown[][];

  // Skip the header row if it exists
  const startIndex = isHeaderRow(inventoryItems[0]) ? 1 : 0;

  return inventoryItems.slice(startIndex).map((row, index) => {
    if (!Array.isArray(row) || row.length < 2) {
      raise(
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
      raise(
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
      raise(
        `Invalid description at row ${
          index + startIndex + 1
        }: Description must be a string or empty`,
      );
    }

    const parsedPrice = parseFloat(price as string);
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      raise(
        `Invalid price at row ${
          index + startIndex + 1
        }: Price must be a non-negative number`,
      );
    }

    return {
      name: (name as string).trim(),
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

// #endregion

// #region invoice items

export const parseInvoiceItems = (
  obj: unknown,
): Array<{ name: string; quantity: number }> => {
  if (!isTwoDimensionalArray(obj)) {
    raise('Invalid format for invoice items');
  }

  const invoiceItems = obj as unknown[][];

  // Skip the header row if it exists
  const startIndex = isHeaderRow(invoiceItems[0]) ? 1 : 0;

  return compact(
    invoiceItems.slice(startIndex).map((row, index) => {
      if (!Array.isArray(row) || row.length < 1) {
        raise(
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
        raise(
          `Invalid name at row ${
            index + startIndex + 1
          }: Name must be a non-empty string`,
        );
      }

      if (typeof quantity !== 'number' || quantity < 0) {
        raise(
          `Invalid quantity at row ${
            index + startIndex + 1
          }: Quantity must be a positive number`,
        );
      }

      return {
        name: (name as string).trim(),
        quantity: quantity as number,
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

// #endregion

// #region opening stock

function isHeaderRowOpeningStock(row: unknown[]): boolean {
  return row.some(
    (cell) =>
      typeof cell === 'string' &&
      ['name', 'quantity'].includes((cell as string).toLowerCase().trim()),
  );
}

/** parses opening stock Excel: rows with name and quantity (header row optional: name, quantity) */
export const parseOpeningStock = (
  obj: unknown,
): Array<{ name: string; quantity: number }> => {
  if (!isTwoDimensionalArray(obj)) {
    raise('Invalid format for opening stock');
  }

  const rows = obj as unknown[][];
  const startIndex = isHeaderRowOpeningStock(rows[0]) ? 1 : 0;

  return compact(
    rows.slice(startIndex).map((row, index) => {
      if (!Array.isArray(row) || row.length < 2) {
        raise(
          `Invalid row at index ${
            index + startIndex
          }: Expected at least name and quantity`,
        );
      }

      // eslint-disable-next-line prefer-const
      let [name, quantity] = row;

      if (typeof name === 'number') {
        name = name.toString();
      }

      if (typeof name !== 'string' || name.trim() === '') {
        raise(
          `Invalid name at row ${
            index + startIndex + 1
          }: Name must be a non-empty string`,
        );
      }

      const rawQty = isNil(quantity) ? 0 : quantity;
      const qty =
        typeof rawQty === 'number' ? rawQty : parseFloat(rawQty as string);
      if (Number.isNaN(qty) || qty < 0) {
        raise(
          `Invalid quantity at row ${
            index + startIndex + 1
          }: Quantity must be a non-negative number`,
        );
      }

      return {
        name: (name as string).trim(),
        quantity: Math.floor(qty),
      };
    }),
  );
};

// #endregion

// #region inventory availability

/** returns true if every parsed item name exists in inventory */
export const checkParsedItemsAvailability = (
  parsedItems: Array<{ name: string; quantity: number }>,
  items: InventoryItem[],
): boolean =>
  parsedItems.every((parsedItem) =>
    items.some((i) => i.name === parsedItem.name),
  );

// #endregion

// #region journal import sheet

/** returns index of first row with Account + Credit/Debit together, or raises with a specific reason */
const resolveJournalImportHeaderRowOrRaise = (rows: unknown[][]): number => {
  let anyAccount = false;
  let anyCreditOrDebit = false;
  for (let i = 0; i < rows.length; i++) {
    const n = map(rows[i], (e) => toLowerString(e).trim());
    const hasAccount = n.includes('account');
    const hasCreditOrDebit = n.includes('credit') || n.includes('debit');
    if (hasAccount) anyAccount = true;
    if (hasCreditOrDebit) anyCreditOrDebit = true;
    if (hasAccount && hasCreditOrDebit) {
      return i;
    }
  }
  if (!anyAccount && !anyCreditOrDebit) {
    return raise('Could not find Account column or a Credit/Debit column');
  }
  if (!anyAccount) return raise('Could not find Account column');
  if (!anyCreditOrDebit) return raise('Could not find Credit or Debit column');
  return raise(
    'Account and Credit or Debit must appear in the same header row',
  );
};

/** spreadsheet with Account plus exactly one of Credit or Debit (case-insensitive headers). Not both Credit and Debit in the same sheet. */
export const parseJournalImportSheet = (obj: unknown) => {
  if (!isTwoDimensionalArray(obj)) {
    raise('Invalid spreadsheet: expected rows of cells');
  }

  const rows = obj as unknown[][];
  if (rows.length < 2) {
    raise('Spreadsheet is empty');
  }

  const headerRowIndex = resolveJournalImportHeaderRowOrRaise(rows);

  const headers = rows[headerRowIndex];
  const normalizedHeaders = map(headers, (e) => toLowerString(e).trim());
  const accountColumnIndex = normalizedHeaders.indexOf('account');
  const creditColumnIndex = normalizedHeaders.indexOf('credit');
  const debitColumnIndex = normalizedHeaders.indexOf('debit');

  if (creditColumnIndex !== -1 && debitColumnIndex !== -1) {
    raise('Include only one of Credit or Debit columns, not both');
  }

  const amountColumnIndex =
    creditColumnIndex !== -1 ? creditColumnIndex : debitColumnIndex;
  const entrySide = creditColumnIndex !== -1 ? BalanceType.Cr : BalanceType.Dr;

  const dataRows = rows.slice(headerRowIndex + 1);

  let skippedRows = 0;
  const entries = compact(
    map(dataRows, (row, rowIndex) => {
      const accountCode = toString(row[accountColumnIndex]).trim();
      const amount = parseCurrencyLikeAmount(row[amountColumnIndex]);
      const excelRowNumber = headerRowIndex + rowIndex + 2;

      if (isEmpty(accountCode) || amount === null || amount <= 0) {
        skippedRows += 1;
        return null;
      }

      return {
        accountCode,
        amount: getFixedNumber(amount, 2),
        rowNumber: excelRowNumber,
      };
    }),
  );

  if (isEmpty(entries)) {
    raise('No valid rows to import');
  }

  return {
    entrySide,
    entries,
    skippedRows,
  };
};

// #endregion
