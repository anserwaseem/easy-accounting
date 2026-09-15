import type { AttributeDefinition } from 'types';

/** converts an edited string back to the type the definition declares */
export const coerceAttributeValue = (
  raw: string,
  valueType: AttributeDefinition['valueType'],
): unknown => {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (valueType === 'number') {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }
  if (valueType === 'bool') return true;
  return trimmed;
};

/** spreadsheet cell text for one stored attribute value */
export const formatAttributeValueForExport = (
  value: unknown,
  valueType: AttributeDefinition['valueType'],
): string => {
  if (value === null || value === undefined) return '';
  if (valueType === 'bool') return value ? 'true' : '';
  return String(value);
};

/**
 * spreadsheet import cell → stored value, or null to clear.
 * bool accepts false/0/no/n as clear so bulk editors can turn flags off.
 */
export const parseAttributeValueFromImport = (
  raw: string,
  valueType: AttributeDefinition['valueType'],
): unknown | null => {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (valueType === 'bool') {
    const lower = trimmed.toLowerCase();
    if (['false', '0', 'no', 'n'].includes(lower)) return null;
    return true;
  }
  const coerced = coerceAttributeValue(trimmed, valueType);
  return coerced === '' ? null : coerced;
};
