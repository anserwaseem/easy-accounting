/**
 * `settings` table keys that are the business itself (letterhead, print
 * labels) — not this device's UI chrome. Renderer hooks and the
 * store→sqlite copy both use this list so a Join from "Add a device"
 * sees the same rows the first device captured.
 *
 * Publish connection keys live next to `PUBLISH_KEYS` on each platform
 * (secrets must never appear here).
 */

export const COMPANY_PROFILE_SETTING_KEYS = {
  name: 'companyProfile.name',
  address: 'companyProfile.address',
  phone: 'companyProfile.phone',
  email: 'companyProfile.email',
  nameUrdu: 'companyProfile.nameUrdu',
  addressUrdu: 'companyProfile.addressUrdu',
  whatsapp: 'companyProfile.whatsapp',
  website: 'companyProfile.website',
  printNote: 'companyProfile.printNote',
  printNoteUrdu: 'companyProfile.printNoteUrdu',
} as const;

export const INVOICE_PRINT_SETTING_KEYS = {
  locale: 'print.locale',
  englishLabelOverrides: 'print.englishLabelOverrides',
  urduLabelOverrides: 'print.urduLabelOverrides',
  showPartyBalances: 'print.showPartyBalances',
  showAgent: 'print.showAgent',
  showBillBalance: 'print.showBillBalance',
  /** legacy; still copied if present so a second device does not lose it */
  totalQuantityLabel: 'print.totalQuantityLabel',
} as const;

export const COMPANY_AND_PRINT_SETTING_KEYS: readonly string[] = [
  ...Object.values(COMPANY_PROFILE_SETTING_KEYS),
  ...Object.values(INVOICE_PRINT_SETTING_KEYS),
];
