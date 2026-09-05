// hover hints for file inputs — keep aligned with parsers in renderer/lib/parser.ts

export const FILE_UPLOAD_HINT_BALANCE_SHEET =
  'Excel: standard balance sheet layout this app expects (section titles and amount columns).\nFiles: .xlsx, .xls, .csv.';

export const FILE_UPLOAD_HINT_INVENTORY_CATALOG =
  'Excel: first row must be headers with name (or item / item code) and price; optional description and list #. Any column order.\nFiles: .xlsx, .xls, .csv.';

export const FILE_UPLOAD_HINT_OPENING_STOCK =
  'Columns: item name and quantity. Optional header row with name and quantity labels.\nFiles: .xlsx, .xls, .csv.';

export const FILE_UPLOAD_HINT_VENDOR_OPENING_STOCK =
  'Columns: vendor_code (or vendor_name), item name, quantity. Header row recommended.\nPrefer family-head names; variant names coerce to the head and same-head rows sum.\nAccount must have “Track stock at this vendor” enabled.\nFile is previewed first — nothing writes until you confirm.\nFiles: .xlsx, .xls, .csv.';

export const FILE_UPLOAD_HINT_LIST_POSITION_IMPORT =
  'Excel: header row with name (or item / item code) and list (or list #).\nFiles: .xlsx, .xls, .csv.';

export const FILE_UPLOAD_HINT_JOURNAL_ENTRIES =
  'Excel: header row must include Code or Account (or both), and either Credit or Debit (not both); positive amounts.\nFiles: .xlsx, .xls, .csv.';

export const FILE_UPLOAD_HINT_INVOICE_ITEMS =
  'Excel: two columns—item name, then quantity per row. Optional header row when the first row looks like column titles.\nFiles: .xlsx, .xls, .csv.';

export const FILE_UPLOAD_HINT_ACCOUNT_URDU =
  'Excel: header row with Id (preferred) or Name/Code to match accounts, plus Name (Urdu), Address (Urdu), and/or Goods Name (Urdu). Empty Urdu cells clear the field.\nFiles: .xlsx, .xls, .csv.';

export const FILE_UPLOAD_HINT_INVENTORY_URDU =
  'Excel: header row with Id (preferred) or Name to match items, plus Description (Urdu). Empty Urdu cells clear the field.\nFiles: .xlsx, .xls, .csv.';
