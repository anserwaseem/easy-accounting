import { Card } from '@/renderer/shad/ui/card';
import { cn } from '@/renderer/lib/utils';
import { EmptyState, LoadingState } from '../components';
import {
  collectionSheetHeaders,
  collectionSheetTotals,
  formatSheetAmount,
  type CollectionSheetLanguage,
  type CollectionSheetRow,
} from './buildCollectionSheetRows';

interface CollectionSheetTableProps {
  rows: CollectionSheetRow[];
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

export const CollectionSheetTable: React.FC<CollectionSheetTableProps> = ({
  rows,
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
  const urdu = language === 'ur';

  return (
    <Card className="shadow-md print-card overflow-x-auto">
      <table
        className="w-full border-collapse text-sm"
        dir={urdu ? 'rtl' : 'ltr'}
      >
        <thead>
          <tr className="text-start">
            <th className={cn(headCell, 'text-end w-10')}>{headers.serial}</th>
            <th className={cn(headCell, 'text-start')}>{headers.shop}</th>
            <th className={cn(headCell, 'text-start')}>{headers.address}</th>
            <th dir="ltr" className={cn(headCell, 'text-left')}>
              {headers.code}
            </th>
            <th dir="ltr" className={cn(headCell, 'text-left')}>
              {headers.bill}
            </th>
            <th dir="ltr" className={cn(headCell, 'text-left')}>
              {headers.billDate}
            </th>
            <th className={cn(headCell, 'text-end')}>{headers.balance}</th>
            <th className={cn(headCell, 'text-end')}>{headers.collected}</th>
            <th className={cn(headCell, 'text-start', writeCell)}>
              {headers.collection}
            </th>
            <th className={cn(headCell, 'text-start', writeCell)}>
              {headers.difference}
            </th>
            <th className={cn(headCell, 'text-start', writeCell)}>
              {headers.remaining}
            </th>
          </tr>
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
            <td className={bodyCell} />
            <td className={bodyCell} />
            <td className={bodyCell} />
          </tr>
        </tfoot>
      </table>
    </Card>
  );
};
