import { toString, trim } from 'lodash';
import type { Account } from 'types';

export interface AccountUrduExportRow {
  id: number;
  code: string;
  name: string;
  nameUrdu: string;
  address: string;
  addressUrdu: string;
  goodsName: string;
  goodsNameUrdu: string;
}

export interface AccountUrduPatch {
  /** preferred match key when present and valid */
  id?: number;
  code?: string;
  name?: string;
  nameUrdu?: string | null;
  addressUrdu?: string | null;
  goodsNameUrdu?: string | null;
}

export interface AccountUrduImportResult {
  patches: AccountUrduPatch[];
  skippedRows: number;
}

const HEADER_ALIASES: Record<
  keyof Omit<AccountUrduExportRow, never>,
  string[]
> = {
  id: ['id', 'account id', 'accountid'],
  code: ['code', 'account code', 'accountcode'],
  name: ['name', 'account', 'account name', 'accountname'],
  nameUrdu: ['nameurdu', 'name (urdu)', 'account name (urdu)', 'urdu name'],
  address: ['address'],
  addressUrdu: ['addressurdu', 'address (urdu)', 'urdu address'],
  goodsName: ['goodsname', 'goods name', 'goods'],
  goodsNameUrdu: [
    'goodsnameurdu',
    'goods name (urdu)',
    'goods (urdu)',
    'urdu goods',
  ],
};

const normalizeHeader = (value: unknown): string =>
  toString(value).trim().toLowerCase().replace(/\s+/g, ' ');

const cellText = (value: unknown): string => trim(toString(value ?? ''));

export const buildAccountUrduExportRows = (
  accounts: Account[],
): AccountUrduExportRow[] =>
  accounts.map((account) => ({
    id: account.id,
    code: account.code == null ? '' : String(account.code),
    name: account.name,
    nameUrdu: account.nameUrdu ?? '',
    address: account.address ?? '',
    addressUrdu: account.addressUrdu ?? '',
    goodsName: account.goodsName ?? '',
    goodsNameUrdu: account.goodsNameUrdu ?? '',
  }));

const resolveHeaderMap = (
  headerRow: unknown[],
): Partial<Record<keyof AccountUrduExportRow, number>> => {
  const map: Partial<Record<keyof AccountUrduExportRow, number>> = {};
  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    (Object.keys(HEADER_ALIASES) as Array<keyof AccountUrduExportRow>).forEach(
      (key) => {
        if (map[key] != null) return;
        if (HEADER_ALIASES[key].includes(normalized)) {
          map[key] = index;
        }
      },
    );
  });
  return map;
};

/** parse spreadsheet rows (header + data) into Urdu field patches */
export const parseAccountUrduImportRows = (
  rows: unknown[],
): AccountUrduImportResult => {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error(
      'Urdu import needs a header row and at least one data row.',
    );
  }

  const headerRow = rows[0];
  if (!Array.isArray(headerRow)) {
    throw new Error('Urdu import header row is invalid.');
  }

  const headerMap = resolveHeaderMap(headerRow);
  if (
    headerMap.nameUrdu == null &&
    headerMap.addressUrdu == null &&
    headerMap.goodsNameUrdu == null
  ) {
    throw new Error(
      'Urdu import needs at least one of: Name (Urdu), Address (Urdu), Goods Name (Urdu).',
    );
  }
  if (
    headerMap.id == null &&
    headerMap.name == null &&
    headerMap.code == null
  ) {
    throw new Error(
      'Urdu import needs Id, or Name, or Code to match accounts.',
    );
  }

  const patches: AccountUrduPatch[] = [];
  let skippedRows = 0;

  rows.slice(1).forEach((row) => {
    if (!Array.isArray(row)) {
      skippedRows += 1;
      return;
    }

    const idRaw = headerMap.id != null ? cellText(row[headerMap.id]) : '';
    const id = idRaw ? Number(idRaw) : undefined;
    const code =
      headerMap.code != null ? cellText(row[headerMap.code]) : undefined;
    const name =
      headerMap.name != null ? cellText(row[headerMap.name]) : undefined;

    const hasMatchKey =
      (id != null && Number.isFinite(id) && id > 0) ||
      Boolean(name) ||
      Boolean(code);
    if (!hasMatchKey) {
      skippedRows += 1;
      return;
    }

    const patch: AccountUrduPatch = {};
    if (id != null && Number.isFinite(id) && id > 0) patch.id = id;
    if (code) patch.code = code;
    if (name) patch.name = name;

    if (headerMap.nameUrdu != null) {
      patch.nameUrdu = cellText(row[headerMap.nameUrdu]) || null;
    }
    if (headerMap.addressUrdu != null) {
      patch.addressUrdu = cellText(row[headerMap.addressUrdu]) || null;
    }
    if (headerMap.goodsNameUrdu != null) {
      patch.goodsNameUrdu = cellText(row[headerMap.goodsNameUrdu]) || null;
    }

    if (
      patch.nameUrdu === undefined &&
      patch.addressUrdu === undefined &&
      patch.goodsNameUrdu === undefined
    ) {
      skippedRows += 1;
      return;
    }

    patches.push(patch);
  });

  return { patches, skippedRows };
};

export const ACCOUNT_URDU_EXPORT_HEADERS = [
  'Id',
  'Code',
  'Name',
  'Name (Urdu)',
  'Address',
  'Address (Urdu)',
  'Goods Name',
  'Goods Name (Urdu)',
] as const;
