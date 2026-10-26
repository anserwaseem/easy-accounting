import { toNumber } from 'lodash';
import { type FC, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Invoice, SaleReturnSourceLine } from 'types';
import { InvoiceType } from 'types';
import { toLocalNoonIsoString } from '@/renderer/lib/localDate';
import { invoiceLineAmount } from '@/lib/invoiceLineAmount';
import { Button } from 'renderer/shad/ui/button';
import { Input } from 'renderer/shad/ui/input';
import { toast } from 'renderer/shad/ui/use-toast';
import { useSaleReturnSource } from './useSaleReturnSource';

const todayIso = (): string => toLocalNoonIsoString(new Date());

const lineAmount = (line: SaleReturnSourceLine, qty: number): number =>
  invoiceLineAmount({
    quantity: qty,
    price: line.price,
    discount: line.discount,
    netPrice: line.netPrice,
  });

/** return some lines of one sale. prices stay what that sale charged. */
const ReturnItemsPage: FC = () => {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const invoiceId = toNumber(params.id);
  const { source, error } = useSaleReturnSource(invoiceId);
  const [qtyByLine, setQtyByLine] = useState<Record<number, string>>({});
  const [date, setDate] = useState(todayIso);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!source || saving) return;
    const chosen = source.lines.flatMap((line) => {
      const qty = toNumber(qtyByLine[line.id]);
      if (!(qty > 0)) return [];
      return [{ line, qty }];
    });
    if (chosen.length === 0) {
      toast({
        variant: 'destructive',
        description: 'Enter a quantity coming back on at least one line.',
      });
      return;
    }
    const over = chosen.find(
      ({ line, qty }) => qty > line.quantity - line.returnedQty,
    );
    if (over) {
      toast({
        variant: 'destructive',
        description: `${over.line.inventoryItemName} can return at most ${
          over.line.quantity - over.line.returnedQty
        }.`,
      });
      return;
    }
    const accountIds = chosen.map(({ line }) => line.accountId);
    const distinct = [...new Set(accountIds)];
    const totalAmount = Math.round(
      chosen.reduce((sum, { line, qty }) => sum + lineAmount(line, qty), 0),
    );
    setSaving(true);
    try {
      const invoiceNumber = await window.electron.getNextSaleReturnNumber();
      const invoice: Invoice = {
        id: -1,
        date,
        invoiceNumber,
        invoiceType: InvoiceType.Sale,
        isSaleReturn: true,
        sourceInvoiceId: source.invoiceId,
        returnReason: reason.trim() || null,
        extraDiscount: 0,
        totalAmount,
        biltyNumber: '',
        cartons: 0,
        accountMapping:
          distinct.length <= 1
            ? { singleAccountId: distinct[0], multipleAccountIds: [] }
            : {
                singleAccountId: source.accountId,
                multipleAccountIds: accountIds,
              },
        invoiceItems: chosen.map(({ line, qty }, index) => ({
          id: index + 1,
          inventoryId: line.inventoryId,
          quantity: qty,
          price: line.price,
          discount: line.discount,
          netPrice: line.netPrice ?? undefined,
          discountedPrice: lineAmount(line, 1),
          sourceInvoiceItemId: line.id,
        })),
      };
      const result = await window.electron.insertInvoice(
        InvoiceType.Sale,
        invoice,
      );
      if (!(result.invoiceId > 0)) {
        throw new Error('Failed to save sale return');
      }
      toast({ variant: 'success', description: 'Sale return saved.' });
      navigate(`/sale/invoices/${result.invoiceId}`);
    } catch (err) {
      toast({
        variant: 'destructive',
        description:
          err instanceof Error ? err.message : 'Could not save the return.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return <p className="p-6 text-sm text-destructive">{error}</p>;
  }
  if (!source) {
    return <p className="p-6 text-sm text-muted-foreground">Loading sale…</p>;
  }

  return (
    <div className="flex flex-col gap-4 py-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="title-new">
          Return items from invoice #{source.invoiceNumber}
        </h1>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => navigate(`/sale/invoices/${source.invoiceId}`)}
        >
          Back to invoice
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {source.accountName}. Price and discount stay what this invoice charged.
        The sale itself is left unchanged.
      </p>
      <div className="flex max-w-xs flex-col gap-1 text-sm">
        <span id="sale-return-date-label">Return date</span>
        <Input
          aria-labelledby="sale-return-date-label"
          type="date"
          value={date.slice(0, 10)}
          onChange={(event) => {
            const next = event.target.value;
            if (!next) return;
            const [year, month, day] = next
              .split('-')
              .map((part) => toNumber(part));
            setDate(toLocalNoonIsoString(new Date(year, month - 1, day)));
          }}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-3 font-medium">Item</th>
              <th className="py-2 pr-3 font-medium">Sold</th>
              <th className="py-2 pr-3 font-medium">Already back</th>
              <th className="py-2 pr-3 font-medium">Coming back</th>
              <th className="py-2 font-medium">Price</th>
            </tr>
          </thead>
          <tbody>
            {source.lines.map((line) => {
              const remaining = line.quantity - line.returnedQty;
              return (
                <tr key={line.id} className="border-b">
                  <td className="py-2 pr-3">{line.inventoryItemName}</td>
                  <td className="py-2 pr-3 tabular-nums">{line.quantity}</td>
                  <td className="py-2 pr-3 tabular-nums">{line.returnedQty}</td>
                  <td className="py-2 pr-3">
                    <Input
                      type="number"
                      min={0}
                      max={remaining}
                      step={1}
                      className="h-8 w-24"
                      disabled={remaining <= 0}
                      value={qtyByLine[line.id] ?? ''}
                      onChange={(event) =>
                        setQtyByLine((prev) => ({
                          ...prev,
                          [line.id]: event.target.value,
                        }))
                      }
                    />
                  </td>
                  <td className="py-2 tabular-nums">
                    {lineAmount(line, 1).toFixed(2)}
                    {line.discount ? ` (${line.discount}%)` : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex max-w-lg flex-col gap-1 text-sm">
        <span id="sale-return-reason-label">Reason (optional)</span>
        <Input
          aria-labelledby="sale-return-reason-label"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      <div>
        <Button type="button" disabled={saving} onClick={() => save()}>
          {saving ? 'Saving…' : 'Save return'}
        </Button>
      </div>
    </div>
  );
};

export default ReturnItemsPage;
