import { usePrimaryItemType } from '@/renderer/hooks';
import { isNil, toNumber } from 'lodash';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  dateFormatOptions,
  datetimeFormatOptions,
} from 'renderer/lib/constants';
import {
  computeSectionTotals,
  getQuotationDisplayNumber,
  groupInvoiceItemsByType,
  showInvoiceEditedIndicator,
  stripItemTypeSuffixFromAccountName,
} from '@/renderer/lib/invoiceUtils';
import {
  toastContentFromConvertQuotationError,
  toastContentFromInvoiceReturnError,
} from '@/renderer/lib/ipcUserMessage';
import {
  cn,
  defaultSortingFunctions,
  getFormattedCurrencySafe,
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
import { Pencil, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/shad/ui/dialog';
import { Label } from '@/renderer/shad/ui/label';
import { toast } from '@/renderer/shad/ui/use-toast';

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
  const [isJournalsLoading, setIsJournalsLoading] = useState(false);
  const [isRelatedLoading, setIsRelatedLoading] = useState(false);
  const [ledgerJumpAccounts, setLedgerJumpAccounts] = useState<Account[]>([]);
  const [relatedLedgerBalances, setRelatedLedgerBalances] = useState<
    Record<number, { balance: number; balanceType: BalanceType }>
  >({});
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnReasonDraft, setReturnReasonDraft] = useState('');
  const [isReturning, setIsReturning] = useState(false);
  const [isConvertingQuotation, setIsConvertingQuotation] = useState(false);
  const { primaryItemTypeName, itemTypeNames } = usePrimaryItemType();
  const navigate = useNavigate();
  // eslint-disable-next-line no-console
  console.log('InvoiceDetails', invoiceId, propInvoice, invoice);

  useEffect(() => {
    let cancelled = false;
    const fetchInvoice = async () => {
      if (!isNil(propInvoice)) {
        setInvoice(propInvoice);
        return;
      }
      const inv = await window.electron.getInvoice(invoiceId);
      if (!cancelled) setInvoice(inv);
    };
    fetchInvoice().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [invoiceId, propInvoice]);

  useEffect(() => {
    const inv = invoice;
    if (!inv?.id) return;

    const idsForLedgers = (): number[] => {
      const ids = new Set<number>();
      const headerId = toNumber(inv.invoiceHeaderAccountId);
      if (headerId > 0) ids.add(headerId);
      (inv.invoiceItems ?? []).forEach((it) => {
        const aid = toNumber(it.accountId);
        if (aid > 0) ids.add(aid);
      });
      return [...ids];
    };

    const loadLedgersOnly = async (cancelled: () => boolean) => {
      setIsJournalsLoading(false);
      setRelatedJournals([]);
      setIsRelatedLoading(true);
      setLedgerJumpAccounts([]);
      setRelatedLedgerBalances({});
      try {
        const idList = idsForLedgers();
        if (idList.length === 0) {
          if (!cancelled()) setIsRelatedLoading(false);
          return;
        }
        const [accounts, balanceMap] = await Promise.all([
          window.electron.getAccountsByIds(idList) as Promise<Account[]>,
          window.electron.getLedgerBalancesForAccountIds(idList) as Promise<
            Record<number, { balance: number; balanceType: BalanceType }>
          >,
        ]);
        if (cancelled()) return;
        setLedgerJumpAccounts(accounts);
        setRelatedLedgerBalances(balanceMap);
      } finally {
        if (!cancelled()) setIsRelatedLoading(false);
      }
    };

    if (inv.isQuotation) {
      let cancelled = false;
      const isCancelled = () => cancelled;
      loadLedgersOnly(isCancelled).catch(() => undefined);
      return () => {
        cancelled = true;
        setIsRelatedLoading(false);
      };
    }

    let cancelled = false;
    setIsJournalsLoading(true);
    setIsRelatedLoading(true);
    setRelatedJournals([]);
    setLedgerJumpAccounts([]);
    setRelatedLedgerBalances({});

    const run = async () => {
      try {
        const journalsRaw = (await window.electron.getJournalsByInvoiceId(
          inv.id,
        )) as Journal[];
        if (cancelled) return;

        setRelatedJournals(Array.isArray(journalsRaw) ? journalsRaw : []);
        setIsJournalsLoading(false);

        const idList = idsForLedgers();
        const [accounts, balanceMap] = await Promise.all([
          window.electron.getAccountsByIds(idList) as Promise<Account[]>,
          window.electron.getLedgerBalancesForAccountIds(idList) as Promise<
            Record<number, { balance: number; balanceType: BalanceType }>
          >,
        ]);
        if (cancelled) return;

        setLedgerJumpAccounts(accounts);
        setRelatedLedgerBalances(balanceMap);
      } catch {
        if (!cancelled) {
          setIsJournalsLoading(false);
        }
      } finally {
        if (!cancelled) {
          setIsRelatedLoading(false);
        }
      }
    };

    run().catch(() => undefined);

    return () => {
      cancelled = true;
      setIsJournalsLoading(false);
      setIsRelatedLoading(false);
    };
  }, [invoice]);

  const canEditPostedInvoice = useMemo(() => {
    if (!invoice?.id || isJournalsLoading) return false;
    if (invoice.isReturned) return false;
    if (invoice.isQuotation) return false;
    return relatedJournals.length > 0;
  }, [
    invoice?.id,
    invoice?.isReturned,
    invoice?.isQuotation,
    isJournalsLoading,
    relatedJournals.length,
  ]);

  const showQuotationActions = useMemo(
    () => Boolean(invoice?.isQuotation) && !invoice?.isReturned,
    [invoice?.isQuotation, invoice?.isReturned],
  );

  const reloadInvoice = useCallback(async () => {
    setInvoice(await window.electron.getInvoice(invoiceId));
  }, [invoiceId]);

  const handleConvertQuotation = useCallback(async () => {
    if (!invoice?.id) return;
    setIsConvertingQuotation(true);
    try {
      const { invoiceNumber } = await window.electron.convertQuotation(
        invoice.id,
      );
      toast({
        variant: 'success',
        description: `Converted to ${invoiceType.toLowerCase()} invoice #${invoiceNumber}.`,
      });
      await reloadInvoice();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const { title, description } = toastContentFromConvertQuotationError(raw);
      toast({ variant: 'destructive', title, description });
    } finally {
      setIsConvertingQuotation(false);
    }
  }, [invoice?.id, invoiceType, reloadInvoice]);

  const handleConfirmReturn = useCallback(async () => {
    if (!invoice?.id) return;
    setIsReturning(true);
    try {
      const trimmed = returnReasonDraft.trim();
      const payload = {
        returnReason: trimmed.length > 0 ? trimmed : null,
      };
      if (invoiceType === InvoiceType.Sale) {
        await window.electron.returnSaleInvoice(invoice.id, payload);
      } else {
        await window.electron.returnPurchaseInvoice(invoice.id, payload);
      }
      toast({ description: 'Invoice returned.' });
      setReturnDialogOpen(false);
      setReturnReasonDraft('');
      await reloadInvoice();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const { title, description } = toastContentFromInvoiceReturnError(raw);
      toast({ variant: 'destructive', title, description, duration: 12000 });
    } finally {
      setIsReturning(false);
    }
  }, [invoice?.id, invoiceType, returnReasonDraft, reloadInvoice]);

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
        id: 'itemNumber',
        header: '#',
        size: 10,
        // eslint-disable-next-line react/no-unstable-nested-components
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{row.index + 1}</span>
        ),
      },
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
              cell: ({ getValue }) => getFormattedCurrencySafe(getValue()),
            },
            {
              accessorKey: 'discount',
              header: 'Discount',
              cell: ({ getValue }) => `${getValue()}%`,
            },
            {
              accessorKey: 'discountedPrice',
              header: 'Discounted Price',
              cell: ({ getValue }) => getFormattedCurrencySafe(getValue()),
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
        <div className="flex w-full flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <h1 className="min-w-0 shrink text-4xl font-light">
            {invoice?.isQuotation
              ? `${invoiceType.toUpperCase()} QUOTATION`
              : `${invoiceType.toUpperCase()} INVOICE`}
          </h1>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 md:ml-auto md:w-auto md:shrink-0">
            {invoice &&
            showInvoiceEditedIndicator(invoice) &&
            invoice.updatedAt ? (
              <div
                className="flex gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm shadow-sm md:max-w-sm md:items-end md:text-right"
                role="status"
              >
                <Badge variant="amber" className="w-fit">
                  Last edited
                </Badge>
                <p className="mt-1 text-muted-foreground">
                  {new Date(invoice.updatedAt).toLocaleString(
                    'en-US',
                    datetimeFormatOptions,
                  )}
                </p>
              </div>
            ) : null}
            {canEditPostedInvoice ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive md:h-10"
                onClick={() => {
                  setReturnReasonDraft('');
                  setReturnDialogOpen(true);
                }}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Return
              </Button>
            ) : null}
            {showQuotationActions ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 md:h-10"
                  onClick={() =>
                    navigate(
                      `/${invoiceType.toLowerCase()}/invoices/${
                        invoice!.id
                      }/edit`,
                    )
                  }
                >
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Edit quotation
                </Button>
                <Button
                  type="button"
                  variant="success"
                  size="sm"
                  className="h-9 md:h-10"
                  disabled={isConvertingQuotation}
                  onClick={() => {
                    handleConvertQuotation().catch(() => undefined);
                  }}
                >
                  {isConvertingQuotation ? 'Converting…' : 'Convert to invoice'}
                </Button>
              </>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-8">
          <div className="flex flex-col gap-2 mt-8">
            <div className="flex gap-8 items-center">
              <p className="font-extrabold text-md w-[160px]">
                {invoice?.isQuotation ? 'Quotation #:' : 'Invoice #:'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {invoice?.isQuotation ? (
                  <p className="tabular-nums">
                    {getQuotationDisplayNumber(toNumber(invoice.invoiceNumber))}
                  </p>
                ) : (
                  <p className="tabular-nums">{invoice?.invoiceNumber}</p>
                )}
                {invoice?.isReturned ? (
                  <Badge variant="destructive">Returned</Badge>
                ) : null}
                {canEditPostedInvoice ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() =>
                      navigate(
                        `/${invoiceType.toLowerCase()}/invoices/${
                          invoice!.id
                        }/edit`,
                      )
                    }
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="flex gap-8">
              <p className="font-medium text-md min-w-[160px]">{`${
                invoiceType === InvoiceType.Sale ? 'Customer' : 'Vendor'
              }:`}</p>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <p className="shrink-0 whitespace-nowrap">
                  {customerDisplayName}
                </p>
                {invoice?.accountCode != null ? (
                  <Badge
                    variant="secondary"
                    className="shrink-0 whitespace-nowrap"
                  >
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
            {invoice?.isReturned && invoice.returnedAt ? (
              <div className="flex gap-8">
                <p className="font-medium text-md w-[160px]">Returned:</p>
                <p>
                  {new Date(invoice.returnedAt).toLocaleString(
                    'en-US',
                    datetimeFormatOptions,
                  )}
                </p>
              </div>
            ) : null}
            {invoice?.isReturned &&
            invoice.returnReason != null &&
            String(invoice.returnReason).trim() !== '' ? (
              <div className="flex gap-8">
                <p className="font-medium text-md w-[160px] self-start">
                  Return note:
                </p>
                <p className="whitespace-pre-wrap">{invoice.returnReason}</p>
              </div>
            ) : null}
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
              </>
            ) : null}
            {invoiceType === InvoiceType.Sale ? (
              <>
                {invoice != null && toNumber(invoice.extraDiscount) > 0 ? (
                  <div className="flex gap-8">
                    <p className="font-medium text-md w-[160px]">
                      Extra Discount:
                    </p>
                    <p>{getFormattedCurrencySafe(invoice.extraDiscount)}</p>
                  </div>
                ) : null}
                <div className="flex gap-8">
                  <p className="font-medium text-md w-[160px] self-center">
                    Amount:
                  </p>
                  <p className="border-2 border-green-500 rounded-lg -ml-2 p-2">
                    {invoice ? (
                      getFormattedCurrencySafe(invoice.totalAmount)
                    ) : (
                      <span className="text-muted-foreground">Loading…</span>
                    )}
                  </p>
                </div>
              </>
            ) : null}
          </div>

          {invoiceType === InvoiceType.Purchase ? null : (
            <div className="flex flex-col justify-end gap-4 w-32 ml-auto">
              <Button onClick={handlePrintClick} className="px-4 py-8">
                {invoice?.isQuotation
                  ? 'View Printable Quotation'
                  : 'View Printable Invoice'}
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
                      return getFormattedCurrencySafe(section.totalAmount);
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

      {invoice && !invoice.isQuotation && (
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
                              {getFormattedCurrencySafe(j.amount)}
                            </Badge>
                            {j.isPosted ? (
                              <Badge className="whitespace-nowrap">
                                Posted
                              </Badge>
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
                                  {getFormattedCurrencySafe(latestBal.balance)}{' '}
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
      )}
      {invoice?.isQuotation && (
        <div className="py-6">
          <Separator />
          <div className="pt-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Related ledgers</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {invoice.invoiceType === InvoiceType.Sale
                    ? 'Customer'
                    : 'Vendor'}
                  &nbsp;accounts on this quotation. Journals are created only
                  after invoice is created.
                </p>
              </div>
              {isRelatedLoading ? (
                <p className="text-sm text-muted-foreground shrink-0">
                  Loading…
                </p>
              ) : null}
            </div>
            {ledgerJumpAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-3">
                No accounts found to open ledger.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
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
                              {getFormattedCurrencySafe(latestBal.balance)}{' '}
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
          </div>
        </div>
      )}

      <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {invoiceType === InvoiceType.Sale
                ? 'Return this sale invoice?'
                : 'Return this purchase invoice?'}
            </DialogTitle>
            <DialogDescription>
              {invoiceType === InvoiceType.Sale
                ? 'This removes the linked journals and ledger postings, restocks inventory, and marks the invoice as returned. This cannot be undone.'
                : 'This removes the linked journals and ledger postings, reverses the inventory quantities from this purchase, and marks the invoice as returned. This cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="invoice-return-reason">Reason (optional)</Label>
            <textarea
              id="invoice-return-reason"
              rows={3}
              value={returnReasonDraft}
              onChange={(e) => setReturnReasonDraft(e.target.value)}
              className={cn(
                'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
              )}
              disabled={isReturning}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setReturnDialogOpen(false)}
              disabled={isReturning}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                handleConfirmReturn().catch(() => undefined);
              }}
              disabled={isReturning}
            >
              {isReturning ? 'Returning…' : 'Return invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
