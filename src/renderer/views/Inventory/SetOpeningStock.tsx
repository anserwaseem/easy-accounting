import { convertFileToJson } from '@/renderer/lib/lib';
import { parseOpeningStock } from '@/renderer/lib/parser';
import { Button } from '@/renderer/shad/ui/button';
import { Input } from '@/renderer/shad/ui/input';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from '@/renderer/shad/ui/dialog';
import { toast } from '@/renderer/shad/ui/use-toast';
import { Label } from '@/renderer/shad/ui/label';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { max, toString } from 'lodash';
import { useEffect, useState } from 'react';
import { PackageOpen } from 'lucide-react';
import { toLocalDateInputValue } from '@/renderer/lib/localDate';

interface SetOpeningStockProps {
  refetchInventory?: () => void;
}

export const SetOpeningStock: React.FC<SetOpeningStockProps> = ({
  refetchInventory,
}: SetOpeningStockProps) => {
  const today = toLocalDateInputValue(new Date());
  const [open, setOpen] = useState(false);
  const [asOfDate, setAsOfDate] = useState(today);
  const [resetOthersToZero, setResetOthersToZero] = useState(true);
  const [latestOpeningDate, setLatestOpeningDate] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;

    const fetchLatestOpening = async () => {
      try {
        const rows = await window.electron.getOpeningStock();
        if (!rows || rows.length === 0) {
          setLatestOpeningDate(null);
          return;
        }
        const dates = rows
          .map((row) => row.asOfDate ?? row.createdAt ?? row.updatedAt)
          .filter((d): d is string => Boolean(d));
        if (!dates.length) {
          setLatestOpeningDate(null);
          return;
        }
        const latest = max(dates);
        setLatestOpeningDate(latest ?? null);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to fetch opening stock info', error);
        setLatestOpeningDate(null);
      }
    };

    fetchLatestOpening();
  }, [open]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const json = await convertFileToJson(file);
      const items = parseOpeningStock(json);
      if (items.length === 0) {
        toast({
          description: 'No valid rows in file. Use columns: name, quantity',
          variant: 'destructive',
        });
        return;
      }
      const result = await window.electron.setOpeningStock(
        items.map((i) => ({ name: i.name, quantity: i.quantity })),
        asOfDate || undefined,
        resetOthersToZero,
      );
      if (result.success) {
        refetchInventory?.();
        setOpen(false);
        toast({
          description: `Opening stock set for ${items.length} items.${
            resetOthersToZero ? ' Items not in the file were set to 0.' : ''
          }`,
          variant: 'success',
        });
      } else {
        toast({
          description: result.error ?? 'Failed to set opening stock',
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        description: toString(err),
        variant: 'destructive',
      });
    }
    e.target.value = '';
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-fit">
          <PackageOpen size={16} className="mr-1.5" />
          Set opening stock
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Set opening stock</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Upload an Excel file with columns <strong>name</strong> and&nbsp;
          <strong>quantity</strong> to set starting quantities (e.g. when
          migrating from another system).
        </p>
        <p className="text-xs text-muted-foreground italic">
          Usually done once when you start or switch to this app. You can run it
          again later to correct or restate opening stock if needed.
        </p>
        {latestOpeningDate && (
          <>
            <p className="text-xs text-muted-foreground">
              Last opening stock set on: <strong>{latestOpeningDate}</strong>
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Warning: Running this again will overwrite current quantities with
              the Excel values. Any purchases or sales recorded after the first
              run will no longer be reflected in stock.
            </p>
          </>
        )}
        <div className="space-y-2">
          <Label className="text-sm font-medium">As of date</Label>
          <Input
            type="date"
            value={asOfDate}
            max={today}
            onChange={(e) => setAsOfDate(e.target.value)}
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Checkbox
            id="reset-others-zero"
            checked={resetOthersToZero}
            onCheckedChange={(checked) =>
              setResetOthersToZero(checked === true)
            }
          />
          <Label
            htmlFor="reset-others-zero"
            className="text-xs font-normal text-muted-foreground"
          >
            Set quantity of items not listed in this file to 0
          </Label>
        </div>
        <div className="ml-auto">
          <Button
            className="w-fit"
            onClick={() =>
              document.getElementById('setOpeningStockInput')?.click()
            }
          >
            Choose file
          </Button>
          <Input
            id="setOpeningStockInput"
            type="file"
            accept=".xlsx, .xls"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
