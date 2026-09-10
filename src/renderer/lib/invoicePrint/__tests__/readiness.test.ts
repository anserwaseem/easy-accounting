import { getInvoicePrintReadinessGaps } from '../readiness';

describe('getInvoicePrintReadinessGaps', () => {
  const base = {
    locale: 'ur' as const,
    companyName: 'ABC Traders',
    companyNameUrdu: 'اے بی سی',
    companyAddress: 'Lahore',
    companyAddressUrdu: 'لاہور',
    partyNameEnglish: 'Customer Co',
    partyNameUrdu: 'کسٹمر',
    partyAddressEnglish: 'Karachi',
    partyAddressUrdu: 'کراچی',
    goodsNameEnglish: 'Books',
    goodsNameUrdu: 'کتب',
    showGoodsField: true,
    missingItemDescriptionUrduCount: 0,
    agentNameEnglish: 'Shahbaz',
    agentNameUrdu: 'شہباز',
  };

  it('returns no gaps for english locale', () => {
    expect(getInvoicePrintReadinessGaps({ ...base, locale: 'en' })).toEqual([]);
  });

  it('returns no gaps when all Urdu fields are filled', () => {
    expect(getInvoicePrintReadinessGaps(base)).toEqual([]);
  });

  it('lists missing company and party Urdu fields', () => {
    const gaps = getInvoicePrintReadinessGaps({
      ...base,
      companyNameUrdu: '  ',
      partyNameUrdu: '',
      partyAddressUrdu: '',
      goodsNameUrdu: '',
    });
    expect(gaps.map((g) => g.key)).toEqual([
      'companyName',
      'partyName',
      'partyAddress',
      'goodsName',
    ]);
  });

  it('skips goods gap when showGoodsField is false', () => {
    const gaps = getInvoicePrintReadinessGaps({
      ...base,
      showGoodsField: false,
      goodsNameUrdu: '',
    });
    expect(gaps.find((g) => g.key === 'goodsName')).toBeUndefined();
  });

  it('ignores walk-in dash as english party name', () => {
    const gaps = getInvoicePrintReadinessGaps({
      ...base,
      partyNameEnglish: '—',
      partyNameUrdu: '',
    });
    expect(gaps.find((g) => g.key === 'partyName')).toBeUndefined();
  });

  it('lists missing item description Urdu count', () => {
    const gaps = getInvoicePrintReadinessGaps({
      ...base,
      missingItemDescriptionUrduCount: 3,
    });
    expect(gaps.find((g) => g.key === 'itemDescriptions')).toEqual({
      key: 'itemDescriptions',
      label: 'Item description (Urdu): 3 missing',
    });
  });

  it('lists missing agent Urdu when a custom head is present', () => {
    const gaps = getInvoicePrintReadinessGaps({
      ...base,
      agentNameUrdu: '',
    });
    expect(gaps.find((g) => g.key === 'agentName')).toEqual({
      key: 'agentName',
      label: 'Marketing representative / head name (Urdu)',
    });
  });

  it('skips agent gap when there is no custom head', () => {
    const gaps = getInvoicePrintReadinessGaps({
      ...base,
      agentNameEnglish: '',
      agentNameUrdu: '',
    });
    expect(gaps.find((g) => g.key === 'agentName')).toBeUndefined();
  });
});
