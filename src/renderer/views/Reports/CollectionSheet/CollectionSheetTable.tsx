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

const headCell = 'border border-border px-2 py-2';
const bodyCell = 'border border-border px-2 py-1.5';
const writeCell = 'min-w-[4.5rem]';
const tourCell = 'text-end tabular-nums whitespace-nowrap';
const unpaidCell = 'bg-destructive/10';
const untouredCell = 'bg-amber-100 dark:bg-amber-900/40';

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
    <Card className="shadow-md print-card overflow-x-auto">
      <table
        className="w-full border-collapse text-sm"
        dir={urdu ? 'rtl' : 'ltr'}
      >
        <thead>
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
            <th rowSpan={span} dir="ltr" className={cn(headCell, 'text-left')}>
              {headers.code}
            </th>
            <th rowSpan={span} dir="ltr" className={cn(headCell, 'text-left')}>
              {headers.bill}
            </th>
            <th rowSpan={span} dir="ltr" className={cn(headCell, 'text-left')}>
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
                className={cn(headCell, 'text-end whitespace-nowrap')}
                title="Money received in this range on days no tour covers"
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
              <td dir="auto" className={bodyCell}>
                {row.shop}
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
                className={cn(bodyCell, 'whitespace-nowrap text-left')}
              >
                {row.code}
              </td>
              <td
                dir="ltr"
                className={cn(bodyCell, 'whitespace-nowrap text-left')}
              >
                {row.billNumber}
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
              <td className={cn(bodyCell, 'text-end')}>
                <Amount amount={row.collected} />
              </td>
              {tours.map((tour) => {
                const paid = row.tourPaid[tour.id];
                return (
                  <td
                    key={tour.id}
                    className={cn(
                      bodyCell,
                      tourCell,
                      isUnpaidTourCell(paid) && unpaidCell,
                    )}
                    title={isUnpaidTourCell(paid) ? 'Not paid' : undefined}
                  >
                    {formatTourAmount(paid)}
                  </td>
                );
              })}
              {showUntoured ? (
                <td
                  className={cn(
                    bodyCell,
                    tourCell,
                    isUntouredCell(row.untoured) && untouredCell,
                  )}
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
        <tfoot>
          <tr className="font-medium">
            <td className={bodyCell} />
            <td className={bodyCell}>{headers.total}</td>
            <td className={bodyCell} />
            <td className={bodyCell} />
            <td className={bodyCell} />
            <td className={bodyCell} />
            <td className={cn(bodyCell, 'text-end')}>
              <Amount amount={totals.balance} />
            </td>
            <td className={cn(bodyCell, 'text-end')}>
              <Amount amount={totals.collected} />
            </td>
            {tours.map((tour) => (
              <td key={tour.id} className={cn(bodyCell, tourCell)}>
                {formatTourAmount(tourTotals[tour.id])}
              </td>
            ))}
            {showUntoured ? (
              <td className={cn(bodyCell, tourCell)}>
                {formatTourAmount(untouredTotal)}
              </td>
            ) : null}
            <td className={bodyCell} />
            <td className={bodyCell} />
            <td className={bodyCell} />
          </tr>
        </tfoot>
      </table>
    </Card>
  );
};
