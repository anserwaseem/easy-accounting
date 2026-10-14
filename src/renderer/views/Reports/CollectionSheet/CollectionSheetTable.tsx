import { Card } from '@/renderer/shad/ui/card';
import { cn } from '@/renderer/lib/utils';
import { EmptyState, LoadingState } from '../components';
import {
  collectionSheetHeaders,
  collectionSheetTotals,
  collectionSheetTourTotals,
  collectionSheetUntouredTotal,
  formatSheetAmount,
  formatTourAmount,
  isUnpaidTourCell,
  isUntouredCell,
  tourColumnHeader,
  type CollectionSheetLanguage,
  type CollectionSheetRow,
  type CollectionSheetTourColumn,
} from './buildCollectionSheetRows';

interface CollectionSheetTableProps {
  rows: CollectionSheetRow[];
  tours: CollectionSheetTourColumn[];
  showUntoured: boolean;
  isLoading: boolean;
  hasAgent: boolean;
  language: CollectionSheetLanguage;
}

interface AmountProps {
  amount: number | null;
}

const Amount: React.FC<AmountProps> = ({ amount }: AmountProps) => (
  <span className="tabular-nums">{formatSheetAmount(amount)}</span>
);

const headCell = 'border border-border px-2 py-2 bg-background';
const bodyCell = 'border border-border px-2 py-1.5';
const writeCell = 'min-w-[4.5rem]';
const tourCell = 'text-end tabular-nums whitespace-nowrap';
const unpaidCell = 'bg-destructive/10';

export const CollectionSheetTable: React.FC<CollectionSheetTableProps> = ({
  rows,
  tours,
  showUntoured,
  isLoading,
  hasAgent,
  language,
}: CollectionSheetTableProps) => {
  if (isLoading) return <LoadingState />;
  if (!hasAgent) {
    return <EmptyState message="Select an agent to build the sheet." />;
  }
  if (rows.length === 0) {
    return <EmptyState message="No balances for this agent." />;
  }

  const headers = collectionSheetHeaders(language);
  const totals = collectionSheetTotals(rows);
  const tourIds = tours.map((tour) => tour.id);
  const tourTotals = collectionSheetTourTotals(rows, tourIds);
  const untouredTotal = collectionSheetUntouredTotal(rows);
  const urdu = language === 'ur';
  const hasTours = tours.length > 0;
  // fixed columns span both header rows when tour columns add a second one
  const span = hasTours ? 2 : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
      <Card className="shadow-md print-card relative min-h-0 flex-1 w-full overflow-auto print:overflow-visible">
        <table
          className="w-full border-collapse text-sm print-table"
          dir={urdu ? 'rtl' : 'ltr'}
        >
          <thead className="sticky top-0 z-20 bg-background shadow-[0_1px_0_hsl(var(--border))]">
            <tr className="text-start">
              <th rowSpan={span} className={cn(headCell, 'text-end w-10')}>
                {headers.serial}
              </th>
              <th rowSpan={span} className={cn(headCell, 'text-start')}>
                {headers.shop}
              </th>
              <th rowSpan={span} className={cn(headCell, 'text-start')}>
                {headers.address}
              </th>
              <th
                rowSpan={span}
                dir="ltr"
                className={cn(headCell, 'text-left')}
              >
                {headers.code}
              </th>
              <th
                rowSpan={span}
                dir="ltr"
                className={cn(headCell, 'text-left')}
              >
                {headers.bill}
              </th>
              <th
                rowSpan={span}
                dir="ltr"
                className={cn(headCell, 'text-left')}
              >
                {headers.billDate}
              </th>
              <th rowSpan={span} className={cn(headCell, 'text-end')}>
                {headers.balance}
              </th>
              <th rowSpan={span} className={cn(headCell, 'text-end')}>
                {headers.collected}
              </th>
              {hasTours ? (
                <th
                  colSpan={tours.length}
                  className={cn(headCell, 'text-center')}
                >
                  {headers.tours}
                </th>
              ) : null}
              {showUntoured ? (
                <th
                  rowSpan={span}
                  className={cn(
                    headCell,
                    'text-end whitespace-nowrap text-muted-foreground/80 bg-muted/30 font-normal',
                  )}
                  title="Money received in this range on days no tour covers (operator check)"
                >
                  {headers.untoured}
                </th>
              ) : null}
              <th
                rowSpan={span}
                className={cn(headCell, 'text-start', writeCell)}
              >
                {headers.collection}
              </th>
              <th
                rowSpan={span}
                className={cn(headCell, 'text-start', writeCell)}
              >
                {headers.difference}
              </th>
              <th
                rowSpan={span}
                className={cn(headCell, 'text-start', writeCell)}
              >
                {headers.remaining}
              </th>
            </tr>
            {hasTours ? (
              <tr>
                {tours.map((tour) => (
                  <th
                    key={tour.id}
                    dir="ltr"
                    className={cn(headCell, 'text-end whitespace-nowrap')}
                  >
                    {tourColumnHeader(tour)}
                  </th>
                ))}
              </tr>
            ) : null}
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="align-top">
                <td className={cn(bodyCell, 'text-end tabular-nums')}>
                  {row.serial}
                </td>
                <td
                  dir={row.shopDisplay === '//' ? 'ltr' : 'auto'}
                  className={cn(
                    bodyCell,
                    row.shopDisplay === '//' && 'text-muted-foreground/45',
                    row.shopDisplay === '//' && urdu && 'text-right',
                  )}
                >
                  {row.shopDisplay === '//' ? (
                    '//'
                  ) : (
                    <span>
                      <span className="font-medium">{row.shop}</span>
                      {row.billCount > 1 && row.totalBilled != null ? (
                        <span className="text-muted-foreground/75 text-xs ml-1.5 font-normal whitespace-nowrap">
                          {urdu
                            ? `(${
                                row.billCount
                              } واجب الادا بل · کل: ${formatSheetAmount(
                                row.totalBilled,
                              )})`
                            : `(${
                                row.billCount
                              } due bills · Total Due: ${formatSheetAmount(
                                row.totalBilled,
                              )})`}
                        </span>
                      ) : null}
                    </span>
                  )}
                </td>
                <td
                  dir={row.addressDisplay === '//' ? 'ltr' : 'auto'}
                  className={cn(
                    bodyCell,
                    row.addressDisplay === '//' && 'text-muted-foreground/45',
                    row.addressDisplay === '//' && urdu && 'text-right',
                  )}
                >
                  {row.addressDisplay}
                </td>
                <td
                  dir="ltr"
                  className={cn(
                    bodyCell,
                    'whitespace-nowrap text-left',
                    row.codeDisplay === '//' && 'text-muted-foreground/45',
                  )}
                >
                  {row.codeDisplay}
                </td>
                <td
                  dir="ltr"
                  className={cn(bodyCell, 'whitespace-nowrap text-left')}
                >
                  <span>{row.billNumber}</span>
                  {row.billCount > 1 ? (
                    <span className="text-muted-foreground/60 text-[11px] ml-1 font-mono">
                      ({row.billIndex}/{row.billCount})
                    </span>
                  ) : null}
                </td>
                <td
                  dir="ltr"
                  className={cn(bodyCell, 'whitespace-nowrap text-left')}
                >
                  {row.billDate}
                </td>
                <td className={cn(bodyCell, 'text-end')}>
                  <Amount amount={row.balance} />
                </td>
                <td
                  className={cn(
                    bodyCell,
                    'text-end',
                    row.collected == null && 'text-muted-foreground/35',
                  )}
                  title={
                    row.collected == null
                      ? 'Collected amount credited on first bill row'
                      : undefined
                  }
                >
                  {row.collected == null ? (
                    <span className="select-none">—</span>
                  ) : (
                    <Amount amount={row.collected} />
                  )}
                </td>
                {tours.map((tour) => {
                  const paid = row.tourPaid[tour.id];
                  const isContinuation = paid === null;
                  let tourCellTitle: string | undefined;
                  if (isUnpaidTourCell(paid)) {
                    tourCellTitle = 'Not paid';
                  } else if (isContinuation) {
                    tourCellTitle = 'Tour receipt credited on first bill row';
                  }
                  return (
                    <td
                      key={tour.id}
                      className={cn(
                        bodyCell,
                        tourCell,
                        isUnpaidTourCell(paid) && unpaidCell,
                        isContinuation && 'text-muted-foreground/35',
                      )}
                      title={tourCellTitle}
                    >
                      {isContinuation ? (
                        <span className="select-none">—</span>
                      ) : (
                        formatTourAmount(paid)
                      )}
                    </td>
                  );
                })}
                {showUntoured ? (
                  <td
                    className={cn(
                      bodyCell,
                      tourCell,
                      'text-muted-foreground',
                      isUntouredCell(row.untoured) &&
                        'bg-muted/40 text-foreground font-medium',
                    )}
                    title={
                      isUntouredCell(row.untoured)
                        ? 'Receipt outside recorded tours'
                        : undefined
                    }
                  >
                    {formatTourAmount(row.untoured)}
                  </td>
                ) : null}
                <td className={cn(bodyCell, writeCell)} />
                <td className={cn(bodyCell, writeCell)} />
                <td className={cn(bodyCell, writeCell)} />
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 z-20 border-t border-border bg-muted/95 shadow-[0_-1px_0_hsl(var(--border))] backdrop-blur-sm print:static print:z-auto">
            <tr className="font-semibold bg-muted/95">
              <td className={cn(bodyCell, 'bg-inherit')} />
              <td className={cn(bodyCell, 'bg-inherit')}>{headers.total}</td>
              <td className={cn(bodyCell, 'bg-inherit')} />
              <td className={cn(bodyCell, 'bg-inherit')} />
              <td className={cn(bodyCell, 'bg-inherit')} />
              <td className={cn(bodyCell, 'bg-inherit')} />
              <td className={cn(bodyCell, 'text-end bg-inherit')}>
                <Amount amount={totals.balance} />
              </td>
              <td className={cn(bodyCell, 'text-end bg-inherit')}>
                <Amount amount={totals.collected} />
              </td>
              {tours.map((tour) => (
                <td
                  key={tour.id}
                  className={cn(bodyCell, tourCell, 'bg-inherit')}
                >
                  {formatTourAmount(tourTotals[tour.id])}
                </td>
              ))}
              {showUntoured ? (
                <td
                  className={cn(
                    bodyCell,
                    tourCell,
                    'text-muted-foreground/80 bg-inherit font-normal',
                  )}
                >
                  {formatTourAmount(untouredTotal)}
                </td>
              ) : null}
              <td className={cn(bodyCell, 'bg-inherit')} />
              <td className={cn(bodyCell, 'bg-inherit')} />
              <td className={cn(bodyCell, 'bg-inherit')} />
            </tr>
          </tfoot>
        </table>
      </Card>
    </div>
  );
};
