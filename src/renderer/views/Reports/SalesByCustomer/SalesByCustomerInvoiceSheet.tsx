import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/renderer/shad/ui/sheet';
import type { SalesByCustomerItem } from 'types';

interface SalesByCustomerInvoiceSheetProps {
  item: SalesByCustomerItem | null;
  customerLabel: string;
  dateSubtitle: string;
  showCustomerColumn: boolean;
  onOpenChange: (open: boolean) => void;
}

const formatDate = (value: string): string => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, 'PP');
};

const formatCustomerCell = (
  name: string,
  code: string | number | null | undefined,
): string => {
  if (code == null || code === '') return name;
  return `${name} (${code})`;
};

export const SalesByCustomerInvoiceSheet: React.FC<
  SalesByCustomerInvoiceSheetProps
> = ({
  item,
  customerLabel,
  dateSubtitle,
  showCustomerColumn,
  onOpenChange,
}: SalesByCustomerInvoiceSheetProps) => {
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
            {customerLabel}
            {dateSubtitle ? ` · ${dateSubtitle}` : ''}
          </SheetDescription>
        </SheetHeader>
        {item ? (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Sale #</th>
                {showCustomerColumn ? (
                  <th className="py-2 pr-3 font-medium">Customer</th>
                ) : null}
                <th className="py-2 text-right font-medium">Qty</th>
              </tr>
            </thead>
            <tbody>
              {item.invoices.map((line) => (
                <tr
                  key={`${line.invoiceId}:${line.customerAccountId}`}
                  className="border-b last:border-0"
                >
                  <td className="py-2 pr-3">{formatDate(line.date)}</td>
                  <td className="py-2 pr-3">
                    <Link
                      className="text-primary underline-offset-2 hover:underline"
                      to={`/sale/invoices/${line.invoiceId}`}
                    >
                      {line.invoiceNumber}
                    </Link>
                  </td>
                  {showCustomerColumn ? (
                    <td className="py-2 pr-3">
                      {formatCustomerCell(line.customerName, line.customerCode)}
                    </td>
                  ) : null}
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
