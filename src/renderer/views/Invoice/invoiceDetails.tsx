import { usePrimaryItemType } from '@/renderer/hooks';
import { isNil, toNumber } from 'lodash';
import { useEffect, useMemo, useState } from 'react';
import {
  dateFormatOptions,
  datetimeFormatOptions,
} from 'renderer/lib/constants';
import {
  computeSectionTotals,
  groupInvoiceItemsByType,
  stripItemTypeSuffixFromAccountName,
} from '@/renderer/lib/invoiceUtils';
import {
  defaultSortingFunctions,
  getFormattedCurrency,
} from 'renderer/lib/utils';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import type { Account, InvoiceItemView, InvoiceView, Journal } from 'types';
import { BalanceType, InvoiceType } from 'types';
import { Button } from '@/renderer/shad/ui/button';
import { Badge } from '@/renderer/shad/ui/badge';
import { Separator } from '@/renderer/shad/ui/separator';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/renderer/shad/ui/tabs';
import { Pencil } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface InvoiceDetailsProps {
  invoiceType: InvoiceType;
  invoiceId: number;
  invoice?: InvoiceView;
}

export const InvoiceDetails: React.FC<InvoiceDetailsProps> = ({
  invoiceType,
  invoiceId,
  invoice: propInvoice,
}: InvoiceDetailsProps) => {
  const [invoice, setInvoice] = useState<InvoiceView>();
  const [relatedJournals, setRelatedJournals] = useState<Journal[]>([]);
  const [isRelatedLoading, setIsRelatedLoading] = useState(false);
  const [ledgerJumpAccounts, setLedgerJumpAccounts] = useState<Account[]>([]);
  const [relatedLedgerBalances, setRelatedLedgerBalances] = useState<
    Record<number, { balance: number; balanceType: BalanceType }>
  >({});
  const { primaryItemTypeName, itemTypeNames } = usePrimaryItemType();
  const navigate = useNavigate();
  // eslint-disable-next-line no-console
  console.log('InvoiceDetails', invoiceId, propInvoice, invoice);

  useEffect(() => {
    const fetchInvoice = async () => {
      if (isNil(propInvoice))
        setInvoice(await window.electron.getInvoice(invoiceId));
      else setInvoice(propInvoice);
    };
    fetchInvoice();
  }, [invoiceId, propInvoice]);

  useEffect(() => {
    const inv = invoice;
    if (!inv?.id) return;

    let cancelled = false;
    (async () => {
      try {
        setIsRelatedLoading(true);
        const [journalsRaw, accounts] = await Promise.all([
          window.electron.getJournalsByInvoiceId(inv.id) as Promise<Journal[]>,
          window.electron.getAccounts() as Promise<Account[]>,
        ]);
        if (cancelled) return;

        setRelatedJournals(Array.isArray(journalsRaw) ? journalsRaw : []);
        setRelatedLedgerBalances({});

        const ids = new Set<number>();
        const headerId = toNumber(inv.invoiceHeaderAccountId);
        if (headerId > 0) ids.add(headerId);
        (inv.invoiceItems ?? []).forEach((it) => {
          const id = toNumber(it.accountId);
          if (id > 0) ids.add(id);
        });

        const selected = accounts.filter((a) => ids.has(toNumber(a.id)));
        setLedgerJumpAccounts(selected);

        const balanceMap: Record<
          number,
          { balance: number; balanceType: BalanceType }
        > = {};
        await Promise.all(
          selected.map(async (acc) => {
            const aid = toNumber(acc.id);
            if (aid <= 0) return;
            const row = await window.electron.getLedgerBalance(aid);
            if (cancelled || !row) return;
            balanceMap[aid] = {
              balance: toNumber(row.balance),
              balanceType: row.balanceType,
            };
          }),
        );
        if (!cancelled) setRelatedLedgerBalances(balanceMap);
      } finally {
        if (!cancelled) setIsRelatedLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [invoice]);

  const customerDisplayName = useMemo(
    () =>
      stripItemTypeSuffixFromAccountName(invoice?.accountName, itemTypeNames),
    [invoice?.accountName, itemTypeNames],
  );

  const relatedJournalViews = useMemo(() => {
    return relatedJournals.map((j) => ({
      ...j,
      amount: (j.journalEntries ?? []).reduce(
        (sum, e) => sum + (toNumber(e.debitAmount) || 0),
        0,
      ),
    }));
  }, [relatedJournals]);

  const columns: ColumnDef<InvoiceItemView>[] = useMemo(() => {
    return [
      {
        accessorKey: 'inventoryItemName',
        header: 'Item',
      },
      {
        accessorKey: 'quantity',
        header: 'Quantity',
      },
      ...(invoiceType === InvoiceType.Sale
        ? ([
            {
              accessorKey: 'price',
              header: 'Price',
              cell: ({ getValue }) =>
                getFormattedCurrency(toNumber(getValue())),
            },
            {
              accessorKey: 'discount',
              header: 'Discount',
              cell: ({ getValue }) => `${getValue()}%`,
            },
            {
              accessorKey: 'discountedPrice',
              header: 'Discounted Price',
              cell: ({ getValue }) =>
                getFormattedCurrency(toNumber(getValue())),
            },
          ] as ColumnDef<InvoiceItemView>[])
        : []),
    ];
  }, [invoiceType]);

  const groupedInvoiceItems = useMemo(() => {
    const sections = groupInvoiceItemsByType(
      invoice?.invoiceItems ?? [],
      primaryItemTypeName,
    );
    return sections.map((section) => ({
      ...section,
      ...computeSectionTotals(section.items),
    }));
  }, [invoice?.invoiceItems, primaryItemTypeName]);

  const quantityColumnIndex = useMemo(
    () =>
      columns.findIndex(
        (column) =>
          (column as { accessorKey?: string }).accessorKey === 'quantity',
      ),
    [columns],
  );

  const totalColumnIndex = useMemo(
    () =>
      columns.findIndex((column) => {
        const { accessorKey } = column as { accessorKey?: string };
        if (invoiceType === InvoiceType.Sale)
          return accessorKey === 'discountedPrice';
        return accessorKey === 'price';
      }),
    [columns, invoiceType],
  );

  const handlePrintClick = () => {
    navigate(`/invoices/${invoice!.id}/print`);
  };

  return (
    <div>
      <div className="w-full">
        <h1 className="text-4xl font-light">{`${invoiceType.toUpperCase()} INVOICE`}</h1>
        <div className="grid grid-cols-2">
          <div className="flex flex-col gap-2 mt-8">
            <div className="flex gap-8 items-center">
              <p className="font-extrabold text-md w-[160px]">Invoice #:</p>
              <div className="flex items-center gap-2">
                <p>{invoice?.invoiceNumber}</p>
                {invoice?.id != null && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() =>
                      navigate(
                        `/${invoiceType.toLowerCase()}/invoices/${
                          invoice.id
                        }/edit`,
                      )
                    }
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>
                )}
              </div>
            </div>
            <div className="flex gap-8">
              <p className="font-medium text-md min-w-[160px]">{`${
                invoiceType === InvoiceType.Sale ? 'Customer' : 'Vendor'
              }:`}</p>
              <div className="flex flex-wrap items-center gap-2 min-w-max">
                <p className="whitespace-normal">{customerDisplayName}</p>
                {invoice?.accountCode != null ? (
                  <Badge variant="secondary" className="whitespace-nowrap">
                    {invoice.accountCode}
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="flex gap-8">
              <p className="font-medium text-md w-[160px]">Date:</p>
              <p>
                {invoice?.date
                  ? new Date(invoice.date).toLocaleString(
                      'en-US',
                      dateFormatOptions,
                    )
                  : ''}
              </p>
            </div>
            {invoiceType === InvoiceType.Sale ? (
              <>
                {invoice?.biltyNumber != null &&
                  String(invoice.biltyNumber).trim() !== '' && (
                    <div className="flex gap-8">
                      <p className="font-medium text-md w-[160px]">Bilty #:</p>
                      <p>{invoice.biltyNumber}</p>
                    </div>
                  )}
                {!!invoice?.cartons && (
                  <div className="flex gap-8">
                    <p className="font-medium text-md w-[160px]">Cartons:</p>
                    <p>{invoice.cartons}</p>
                  </div>
                )}
                {invoice?.createdAt !== invoice?.updatedAt &&
                  invoice?.updatedAt && (
                    <p className="text-xs text-muted-foreground mt-1">
                      <span className="font-medium text-foreground">
                        Edited
                      </span>
                      {' · '}
                      {new Date(invoice.updatedAt).toLocaleString(
                        'en-US',
                        datetimeFormatOptions,
                      )}
                    </p>
                  )}
              </>
            ) : null}
            {invoiceType === InvoiceType.Sale ? (
              <>
                <div className="flex gap-8">
                  <p className="font-medium text-md w-[160px]">
                    Extra Discount:
                  </p>
                  <p>
                    {getFormattedCurrency(toNumber(invoice?.extraDiscount))}
                  </p>
                </div>
                <div className="flex gap-8">
                  <p className="font-medium text-md w-[160px] self-center">
                    Amount:
                  </p>
                  <p className="border-2 border-green-500 rounded-lg -ml-2 p-2">
                    {getFormattedCurrency(toNumber(invoice?.totalAmount))}
                  </p>
                </div>
              </>
            ) : null}
          </div>

          {propInvoice || invoiceType === InvoiceType.Purchase ? null : (
            <div className="flex flex-col justify-end gap-4 w-32 ml-auto">
              <Button onClick={handlePrintClick} className="px-4 py-8">
                View Printable Invoice
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-6 py-6">
        {groupedInvoiceItems.map((section) => (
          <div key={section.sectionName} className="space-y-2">
            <h2 className="text-lg font-semibold">{section.sectionName}</h2>
            {section.items.length > 1 ? (
              <DataTable
                columns={columns}
                data={section.items}
                sortingFns={defaultSortingFunctions}
                infoData={[
                  Array.from({ length: columns.length }, (_, index) => {
                    if (index === quantityColumnIndex)
                      return section.totalQuantity;
                    if (index === totalColumnIndex)
                      return getFormattedCurrency(section.totalAmount);
                    return '';
                  }),
                ]}
              />
            ) : (
              <DataTable
                columns={columns}
                data={section.items}
                sortingFns={defaultSortingFunctions}
              />
            )}
          </div>
        ))}
      </div>

      <div className="py-6">
        <Separator />
        <div className="pt-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">Related</h2>
            {isRelatedLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : null}
          </div>

          <Tabs defaultValue="journals" className="mt-3">
            <TabsList>
              <TabsTrigger value="journals">Journals</TabsTrigger>
              <TabsTrigger value="ledgers">Ledgers</TabsTrigger>
            </TabsList>

            <TabsContent value="journals">
              {relatedJournalViews.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-2">
                  No linked journals.
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {relatedJournalViews.map((j) => (
                    <button
                      key={j.id}
                      type="button"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-left hover:bg-muted/40"
                      onClick={() => navigate(`/journals/${j.id}`)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">
                            {j.narration}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(j.date || '').toLocaleString(
                              'en-US',
                              dateFormatOptions,
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="secondary"
                            className="whitespace-nowrap"
                          >
                            {getFormattedCurrency(toNumber(j.amount))}
                          </Badge>
                          {j.isPosted ? (
                            <Badge className="whitespace-nowrap">Posted</Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="whitespace-nowrap"
                            >
                              Draft
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="ledgers">
              {ledgerJumpAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-2">
                  No accounts found to open ledger.
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {ledgerJumpAccounts.map((a) => {
                    const codeStr =
                      a.code != null && String(a.code).trim() !== ''
                        ? String(a.code)
                        : '';
                    const subLine =
                      a.headName ??
                      (codeStr ? `Code ${codeStr}` : 'General ledger');
                    const aid = toNumber(a.id);
                    const latestBal = relatedLedgerBalances[aid];
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-left hover:bg-muted/40"
                        onClick={() => navigate(`/accounts/${a.id}`)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {a.name}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {subLine}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                            {codeStr && a.headName ? (
                              <Badge
                                variant="secondary"
                                className="whitespace-nowrap"
                              >
                                {codeStr}
                              </Badge>
                            ) : null}
                            {latestBal ? (
                              <Badge
                                variant="secondary"
                                className="whitespace-nowrap tabular-nums"
                              >
                                {getFormattedCurrency(latestBal.balance)}{' '}
                                <span className="font-normal text-muted-foreground">
                                  {latestBal.balanceType}
                                </span>
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                No ledger activity
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
};
