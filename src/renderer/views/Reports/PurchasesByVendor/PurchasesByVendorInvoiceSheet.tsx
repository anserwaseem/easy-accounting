import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/renderer/shad/ui/sheet';
import type { PurchasesByVendorItem } from 'types';

interface PurchasesByVendorInvoiceSheetProps {
  item: PurchasesByVendorItem | null;
  vendorName: string;
  dateSubtitle: string;
  onOpenChange: (open: boolean) => void;
}

const formatDate = (value: string): string => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, 'PP');
};

export const PurchasesByVendorInvoiceSheet: React.FC<
  PurchasesByVendorInvoiceSheetProps
> = ({
  item,
  vendorName,
  dateSubtitle,
  onOpenChange,
}: PurchasesByVendorInvoiceSheetProps) => {
  const itemLabel = (() => {
    if (!item) return '';
    return item.itemName;
  })();

  return (
    <Sheet open={item != null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-10">
          <SheetTitle>{itemLabel}</SheetTitle>
          <SheetDescription>
            {vendorName}
            {dateSubtitle ? ` · ${dateSubtitle}` : ''}
          </SheetDescription>
        </SheetHeader>
        {item ? (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Purchase #</th>
                <th className="py-2 text-right font-medium">Qty</th>
              </tr>
            </thead>
            <tbody>
              {item.invoices.map((line) => (
                <tr key={line.invoiceId} className="border-b last:border-0">
                  <td className="py-2 pr-3">{formatDate(line.date)}</td>
                  <td className="py-2 pr-3">
                    <Link
                      className="text-primary underline-offset-2 hover:underline"
                      to={`/purchase/invoices/${line.invoiceId}`}
                    >
                      {line.invoiceNumber}
                    </Link>
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {line.quantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};
