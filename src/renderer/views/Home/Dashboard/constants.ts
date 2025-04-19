export const METRIC_DESCRIPTIONS = {
  totalAssets:
    'Total value of all assets owned by the business, including current and fixed assets.',
  totalLiabilities:
    'Total amount of money owed by the business to external parties.',
  netWorth:
    "Total assets minus total liabilities. Represents the business's true value.",
  currentRatio:
    'Current assets divided by current liabilities. Measures ability to pay short-term obligations. A ratio above 2 is considered healthy.',
  quickRatio:
    '(Current assets - Inventory) divided by current liabilities. Measures ability to pay short-term obligations without selling inventory. A ratio above 1 is considered good.',
  cashAndBank:
    'Total amount of cash and bank balances available to the business. Includes accounts whose name or code contains the word "cash" or "bank".',
  accountsReceivable:
    'Money owed to the business by customers for goods or services sold on credit.',
  accountsPayable:
    'Money owed by the business to suppliers and vendors for goods or services purchased on credit.',
  operatingCashFlow:
    'Cash generated from core business operations, including sales, purchases, and expenses. A positive value indicates healthy operations.',
  investingCashFlow:
    'Cash used for or generated from investments in fixed assets. A negative value is normal as businesses typically invest in assets.',
  financingCashFlow:
    'Cash generated from or used for financing activities like capital contributions and loans. A positive value indicates new funding.',
  netCashFlow:
    'Sum of operating, investing, and financing cash flows. Indicates overall cash position change.',
  cashFlowFromSales:
    'Cash received from sales transactions. A key indicator of revenue generation.',
  cashFlowFromPurchases:
    'Cash spent on inventory and other purchases. A major operating expense.',
  cashFlowFromExpenses:
    'Cash spent on operating expenses. Includes utilities, salaries, and other business costs.',
} as const;

export const CALCULATION_DESCRIPTIONS = {
  totalAssets: 'Sum of all asset account balances (Dr - Cr)',
  totalLiabilities: 'Sum of all liability account balances (Cr - Dr)',
  netWorth: 'Total Assets - Total Liabilities',
  currentRatio: 'Current Assets / Current Liabilities',
  quickRatio: '(Current Assets - Inventory) / Current Liabilities',
  cashAndBank:
    'Sum of account balances where name, code or headName contains "cash" or "bank"',
  accountsReceivable: 'Sum of receivable account balances (Dr - Cr)',
  accountsPayable: 'Sum of payable account balances (Cr - Dr)',
  operatingCashFlow:
    'Sum of current asset changes minus current liability changes',
  investingCashFlow: 'Sum of fixed asset account changes (Dr - Cr)',
  financingCashFlow: 'Sum of equity and loan account changes (Cr - Dr)',
  netCashFlow: 'Operating + Investing + Financing Cash Flows',
  cashFlowFromSales: 'Sum of sale account balances (Cr - Dr)',
  cashFlowFromPurchases: 'Sum of purchase account balances (Dr - Cr)',
  cashFlowFromExpenses: 'Sum of expense account balances (Dr - Cr)',
} as const;
