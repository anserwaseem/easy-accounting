import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/renderer/shad/ui/tooltip';
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
  tourColumnRange,
  type CollectionSheetLanguage,
  type CollectionSheetRow,
  type CollectionSheetTourColumn,
} from './buildCollectionSheetRows';

interface CollectionSheetTableProps {
  rows: CollectionSheetRow[];
  tours: CollectionSheetTourColumn[];
  showUntoured: boolean;
  visibleColumns?: ReadonlySet<string>;
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

interface HeaderWithTooltipProps {
  label: string;
  tooltip: string;
  align?: 'start' | 'end' | 'center' | 'left' | 'right';
  className?: string;
}

const HeaderWithTooltip: React.FC<HeaderWithTooltipProps> = ({
  label,
  tooltip,
  align = 'start',
  className,
}: HeaderWithTooltipProps) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span
        className={cn(
          'inline-flex items-center gap-1 cursor-help group select-none',
          align === 'end' && 'justify-end',
          align === 'center' && 'justify-center',
          className,
        )}
      >
        <span>{label}</span>
        <HelpCircle className="h-3 w-3 text-muted-foreground/60 opacity-60 group-hover:opacity-100 transition-opacity print:hidden shrink-0" />
      </span>
    </TooltipTrigger>
    <TooltipContent
      side="top"
      className="max-w-xs text-xs font-normal text-start normal-case"
    >
      {tooltip}
    </TooltipContent>
  </Tooltip>
);

const headCell =
  'border border-border px-1 py-2 bg-background text-[11px] leading-tight';
const bodyCell = 'border border-border px-1 py-1';
const writeCell = 'w-[3.75rem] min-w-[3.75rem]';
const tourCell = 'text-end tabular-nums whitespace-nowrap px-1';
const unpaidCell = 'bg-destructive/10';
// the code column is the sheet's only identity column, so it stays in view
// while the tour columns scroll sideways; the blurred shadow marks it as
// floating above the columns sliding underneath. bg is set per surface
const codeRail =
  'sticky start-0 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.35)] rtl:shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.35)]';

export const CollectionSheetTable: React.FC<CollectionSheetTableProps> = ({
  rows,
  tours: allTours,
  showUntoured,
  visibleColumns,
  isLoading,
  hasAgent,
  language,
}: CollectionSheetTableProps) => {
  // default to all columns visible when no selection is supplied
  const defaultVisible = new Set([
    'code',
    'billNumber',
    'billDate',
    'balance',
    ...allTours.map((tour) => `tour_${tour.id}`),
    ...(showUntoured ? ['untoured'] : []),
    'collection',
    'difference',
    'remaining',
  ]);
  const vc = visibleColumns ?? defaultVisible;
  const isVisible = (id: string) => vc.has(id);
  const visibleTours = allTours.filter((tour) => isVisible(`tour_${tour.id}`));
  const tours = visibleTours;
  const hasTours = visibleTours.length > 0;
  const showUntouredVisible = showUntoured && isVisible('untoured');
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
  // hasTours already defined above from visibleTours
  // fixed columns span both header rows when tour columns add a second one
  const span = hasTours ? 2 : undefined;
  // one row per bill; the sticky code is the only shop identity left, so the
  // multi-bill and total-due summary that used to sit in the Shop cell lives
  // in its tooltip instead of widening the table
  const codeTitle = (row: CollectionSheetRow): string | undefined => {
    if (row.billIndex !== 1 || row.billCount <= 1 || row.totalBilled == null) {
      return undefined;
    }
    const total = formatSheetAmount(row.totalBilled);
    return urdu
      ? `${row.billCount} واجب الادا بل · کل: ${total}`
      : `${row.billCount} due bills · Total Due: ${total}`;
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        <Card className="shadow-md print-card relative min-h-0 flex-1 w-full overflow-auto print:overflow-visible">
          <table
            className="w-full border-collapse text-sm print-table"
            dir={urdu ? 'rtl' : 'ltr'}
          >
            <thead className="sticky top-0 z-20 bg-background shadow-[0_1px_0_hsl(var(--border))]">
              <tr className="text-start">
                {isVisible('code') ? (
                  <th
                    rowSpan={span}
                    dir="ltr"
                    className={cn(headCell, codeRail, 'z-30 text-left')}
                  >
                    {headers.code}
                  </th>
                ) : null}
                {isVisible('billNumber') ? (
                  <th
                    rowSpan={span}
                    dir="ltr"
                    className={cn(headCell, 'text-left whitespace-nowrap')}
                  >
                    {headers.bill}
                  </th>
                ) : null}
                {isVisible('billDate') ? (
                  <th
                    rowSpan={span}
                    dir="ltr"
                    className={cn(headCell, 'text-left whitespace-nowrap')}
                  >
                    {headers.billDate}
                  </th>
                ) : null}
                {isVisible('balance') ? (
                  <th rowSpan={span} className={cn(headCell, 'text-end')}>
                    <HeaderWithTooltip
                      label={headers.balance}
                      align="end"
                      tooltip={
                        urdu
                          ? 'اس بل کی واجب الادا رقم (پہلے واجب الادا بل پہلے ادا ہوتے ہیں)۔ ادا شدہ پرانے بل خارج ہیں۔'
                          : 'Active unpaid balance on this bill (settled FIFO against customer balance). Fully paid older bills are omitted.'
                      }
                    />
                  </th>
                ) : null}
                {hasTours ? (
                  <th
                    colSpan={tours.length}
                    className={cn(headCell, 'text-center')}
                  >
                    <HeaderWithTooltip
                      label={headers.tours}
                      align="center"
                      tooltip={
                        urdu
                          ? 'ہر کالم میں اوپر اس دورے کے دوران وصولی اور نیچے اس دورے کے اختتام پر گاہک کا بقایا (سرمئی) ہے۔ سرخ 0 کا مطلب ہے کہ اس دورے میں کوئی وصولی نہیں ہوئی۔'
                          : 'Top number: receipts collected during that tour. Grey number below it: the shop’s balance at the end of that tour. A red 0 means nothing was collected on that tour.'
                      }
                    />
                  </th>
                ) : null}
                {showUntouredVisible ? (
                  <th
                    rowSpan={span}
                    className={cn(
                      headCell,
                      'w-[4.5rem] text-end text-muted-foreground/80 bg-muted/30 font-normal',
                    )}
                  >
                    <HeaderWithTooltip
                      label={headers.untoured}
                      align="end"
                      tooltip={
                        urdu
                          ? 'دوروں کے درمیانی دنوں میں وصول ہونے والی رقم (مثلاً دورہ 30 کو ختم ہوا اور رقم 31 کو موصول ہوئی)۔ تاریخ درست کرنے کے لیے اوپر Tours پر کلک کریں۔'
                          : 'Receipts on days outside recorded tours (e.g. tour ended a day early). Click Tours above to extend the tour dates.'
                      }
                    />
                  </th>
                ) : null}
                <th
                  rowSpan={span}
                  className={cn(headCell, 'text-start', writeCell)}
                >
                  <HeaderWithTooltip
                    label={headers.collection}
                    tooltip={
                      urdu
                        ? 'پرنٹ پر خالی کالم جہاں ایجنٹ دورے کے دوران نئی وصولی درج کرے گا۔'
                        : 'Blank column on printouts for the agent to log receipts during their route visit.'
                    }
                  />
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
                  <HeaderWithTooltip
                    label={headers.remaining}
                    tooltip={
                      urdu
                        ? 'پرنٹ پر خالی کالم جہاں ایجنٹ نیا بقایا (واجب الادا منہا وصولی) درج کرے گا۔'
                        : 'Blank column for the agent to calculate and note remaining balance (Due amount − Collection).'
                    }
                  />
                </th>
              </tr>
              {hasTours ? (
                <tr>
                  {tours.map((tour) => (
                    <th
                      key={tour.id}
                      dir="ltr"
                      className={cn(
                        headCell,
                        'w-[5.5rem] min-w-[4.75rem] text-center align-bottom font-normal',
                      )}
                    >
                      <span className="block font-semibold leading-tight">
                        {tour.name}
                      </span>
                      <span className="block whitespace-nowrap text-[10px] leading-tight text-muted-foreground">
                        {tourColumnRange(tour)}
                        {tour.clipped ? ' (part)' : ''}
                      </span>
                    </th>
                  ))}
                </tr>
              ) : null}
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="align-top">
                  <td
                    dir="ltr"
                    title={codeTitle(row)}
                    className={cn(
                      bodyCell,
                      codeRail,
                      'z-10 bg-background whitespace-nowrap text-left',
                      row.billIndex === 1
                        ? 'font-medium'
                        : 'text-muted-foreground/45',
                    )}
                  >
                    {row.billIndex === 1 ? row.code : '//'}
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
                  {tours.map((tour) => {
                    const paid = row.tourPaid[tour.id];
                    const balance = row.tourBalance[tour.id];
                    const isContinuation = paid === null;
                    const titleParts: string[] = [];
                    if (isContinuation) {
                      titleParts.push(
                        'Tour receipt credited on first bill row',
                      );
                    } else if (isUnpaidTourCell(paid)) {
                      titleParts.push('Not paid');
                    }
                    if (balance != null) {
                      titleParts.push(
                        `Balance at tour end: ${formatSheetAmount(balance)}`,
                      );
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
                        title={
                          titleParts.length > 0
                            ? titleParts.join(' · ')
                            : undefined
                        }
                      >
                        {isContinuation ? (
                          <span className="select-none">—</span>
                        ) : (
                          <>
                            <div>
                              {isUnpaidTourCell(paid)
                                ? '0'
                                : formatTourAmount(paid)}
                            </div>
                            {balance != null ? (
                              <div className="mt-0.5 border-t border-border/60 pt-0.5 text-[10px] leading-tight font-normal text-muted-foreground/80">
                                {formatSheetAmount(balance)}
                              </div>
                            ) : null}
                          </>
                        )}
                      </td>
                    );
                  })}
                  {showUntouredVisible ? (
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
                <td
                  dir="ltr"
                  className={cn(bodyCell, codeRail, 'z-30 bg-muted text-left')}
                >
                  {headers.total}
                </td>
                <td className={cn(bodyCell, 'bg-inherit')} />
                <td className={cn(bodyCell, 'bg-inherit')} />
                <td className={cn(bodyCell, 'text-end bg-inherit')}>
                  <Amount amount={totals.balance} />
                </td>
                {tours.map((tour) => (
                  <td
                    key={tour.id}
                    className={cn(bodyCell, tourCell, 'bg-inherit')}
                  >
                    {formatTourAmount(tourTotals[tour.id])}
                  </td>
                ))}
                {showUntouredVisible ? (
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
    </TooltipProvider>
  );
};
