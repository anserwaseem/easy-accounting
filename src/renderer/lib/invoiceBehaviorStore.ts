import { InvoiceType } from 'types';

export const BLOCK_SAVE_WHEN_SPLIT_TYPED_ACCOUNT_MISSING_KEY =
  'invoice.blockSaveWhenSplitTypedAccountMissing' as const;

/** shown on disabled submit and in toast when guard trips */
export const splitTypedAccountMissingSubmitBlockedReason =
  'Typed customer accounts are missing for some lines.';

/**
 * when store is unset or true, block saves while split-by-type resolution fallbacks exist.
 * explicit false opts out (Settings).
 */
export const readBlockSaveWhenSplitTypedAccountMissing = (): boolean =>
  window.electron.store.get(BLOCK_SAVE_WHEN_SPLIT_TYPED_ACCOUNT_MISSING_KEY) !==
  false;

export const isSplitTypedAccountResolutionSubmitBlocked = (args: {
  invoiceType: InvoiceType;
  useSingleAccount: boolean;
  splitByItemType: boolean;
  resolutionFallbackCount: number;
}): boolean =>
  readBlockSaveWhenSplitTypedAccountMissing() &&
  args.invoiceType === InvoiceType.Sale &&
  args.useSingleAccount &&
  args.splitByItemType &&
  args.resolutionFallbackCount > 0;
