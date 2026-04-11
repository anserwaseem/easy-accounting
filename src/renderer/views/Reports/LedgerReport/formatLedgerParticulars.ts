import type { LedgerView } from '@/types';
import type { LedgerParticularsExportMode } from 'renderer/lib/reportExport';

const linkedCodeToString = (row: LedgerView): string => {
  const c = row.linkedAccountCode;
  if (c == null || c === '') return '';
  return String(c);
};

/** builds particulars cell text for excel / print from user-selected mode */
export const formatLedgerParticularsForExport = (
  row: LedgerView,
  mode: LedgerParticularsExportMode,
): string => {
  const name = row.linkedAccountName ?? row.particulars;
  const code = linkedCodeToString(row);
  if (mode === 'name') return name;
  if (mode === 'code') return code;
  if (code) return `${name} (${code})`;
  return name;
};
