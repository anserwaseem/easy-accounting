/**
 * @jest-environment jsdom
 *
 * Hiding Code used to leave Shop and City in the body while the header
 * started at Bill. Every amount then printed under the wrong heading.
 */
import { buildCollectionSheetPrintHtml } from '../printCollectionSheet';
import type {
  CollectionSheetRow,
  CollectionSheetTourColumn,
} from '../buildCollectionSheetRows';

const tours: CollectionSheetTourColumn[] = [
  {
    id: 8,
    name: 'Apr 2026',
    startDate: '2026-04-01',
    endDate: '2026-04-26',
  },
  {
    id: 9,
    name: 'May 2026',
    startDate: '2026-05-01',
    endDate: '2026-05-20',
  },
];

const row = (
  overrides: Partial<CollectionSheetRow> = {},
): CollectionSheetRow => ({
  id: '1',
  serial: 1,
  shop: 'MAKTABA ISLAMIA',
  city: 'Abbottabad',
  shopDisplay: 'MAKTABA ISLAMIA',
  cityDisplay: 'Abbottabad',
  address: '',
  addressDisplay: '',
  code: '786',
  codeDisplay: '786',
  billNumber: '10231',
  billDate: '22 Aug, 2026',
  balance: 32737,
  collected: 10000,
  tourPaid: { 8: 0, 9: 10000 },
  tourBalance: { 8: 32737, 9: 22737 },
  untoured: 0,
  billIndex: 1,
  billCount: 1,
  totalBilled: 32737,
  ...overrides,
});

const spanOf = (tableRow: HTMLTableRowElement): number =>
  [...tableRow.cells].reduce((sum, cell) => sum + cell.colSpan, 0);

const printTable = (
  visible: string[],
  showUntoured = true,
): HTMLTableElement => {
  const html = buildCollectionSheetPrintHtml({
    rows: [row()],
    tours,
    showUntoured,
    title: 'Collection sheet',
    subtitle: '01 Apr, 2026 - 21 Oct, 2026',
    language: 'en',
    visibleColumns: new Set(visible),
  });
  expect(html).toBeTruthy();
  const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
  const table = doc.querySelector('table');
  if (!table) throw new Error('print markup has no table');
  return table;
};

describe('collection sheet print columns', () => {
  const visibleWithoutCodeOrUntoured = [
    'shop',
    'city',
    'billNumber',
    'billDate',
    'balance',
    'tour_8',
    'tour_9',
    'collection',
    'difference',
    'remaining',
  ];

  it('keeps header, body, and totals on the same columns after Code and Not in a tour are hidden', () => {
    const table = printTable(visibleWithoutCodeOrUntoured);
    const header = table.tHead?.rows[0];
    const body = table.tBodies[0]?.rows[0];
    const totals = table.tBodies[0]?.rows[1];
    if (!header || !body || !totals) throw new Error('missing print rows');

    expect(spanOf(header)).toBe(spanOf(body));
    expect(spanOf(totals)).toBe(spanOf(body));
    expect(header.cells[0].textContent).toBe('Customer');
    expect(header.cells[1].textContent).toBe('City');
    expect(body.cells[0].textContent).toBe('MAKTABA ISLAMIA');
    expect(body.cells[1].textContent).toBe('Abbottabad');
    expect(body.cells[2].textContent).toBe('10231');
    expect([...header.cells].map((cell) => cell.textContent)).not.toContain(
      'Code',
    );
    expect(table.textContent).not.toContain('Not in a tour');
  });

  it('still lines up when Shop and City are hidden and Code stays', () => {
    const table = printTable([
      'code',
      'billNumber',
      'billDate',
      'balance',
      'tour_8',
      'collection',
      'difference',
      'remaining',
    ]);
    const header = table.tHead?.rows[0];
    const body = table.tBodies[0]?.rows[0];
    const totals = table.tBodies[0]?.rows[1];
    if (!header || !body || !totals) throw new Error('missing print rows');

    expect(spanOf(header)).toBe(spanOf(body));
    expect(spanOf(totals)).toBe(spanOf(body));
    expect(header.cells[0].textContent).toBe('Code');
    expect(body.cells[0].textContent).toBe('786');
    expect(body.cells[1].textContent).toBe('10231');
  });
});
