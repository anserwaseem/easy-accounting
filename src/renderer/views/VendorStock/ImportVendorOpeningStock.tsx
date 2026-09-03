import { useState } from 'react';
import { PackageOpen } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { Input } from '@/renderer/shad/ui/input';
import { Label } from '@/renderer/shad/ui/label';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/renderer/shad/ui/dialog';
import { FileUploadTooltip } from '@/renderer/components/FileUploadTooltip';
import { FILE_UPLOAD_HINT_VENDOR_OPENING_STOCK } from '@/renderer/lib/fileUploadTooltips';
import { convertFileToJson } from '@/renderer/lib/lib';
import { parseVendorOpeningStock } from '@/renderer/lib/parser';
import { toLocalDateInputValue } from '@/renderer/lib/localDate';
import { toast } from '@/renderer/shad/ui/use-toast';
import { toString } from 'lodash';

interface ImportVendorOpeningStockProps {
  onImported?: () => void;
}

export const ImportVendorOpeningStock: React.FC<
  ImportVendorOpeningStockProps
> = ({ onImported }: ImportVendorOpeningStockProps) => {
  const today = toLocalDateInputValue(new Date());
  const [open, setOpen] = useState(false);
  const [asOfDate, setAsOfDate] = useState(today);
  const [resetOthersToZero, setResetOthersToZero] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const json = await convertFileToJson(file, { preferDisplayText: true });
      const rows = parseVendorOpeningStock(json);
      if (rows.length === 0) {
        toast({
          description:
            'No valid rows. Use columns: vendor_code (or vendor_name), name, quantity',
          variant: 'destructive',
        });
        return;
      }
      const result = await window.electron.importVendorOpeningStock(
        rows,
        asOfDate || today,
        resetOthersToZero,
      );
      if (result.success) {
        onImported?.();
        setOpen(false);
        toast({
          description: `Opening vendor stock set for ${rows.length} rows.`,
          variant: 'success',
        });
      } else {
        toast({
          description: result.error ?? 'Failed to import vendor opening stock',
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
        <Button variant="outline" size="sm">
          <PackageOpen size={16} className="mr-1.5" />
          Import opening
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Import vendor opening stock</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="vendorOpeningAsOf">As of date</Label>
            <Input
              id="vendorOpeningAsOf"
              type="date"
              value={asOfDate}
              onChange={(ev) => setAsOfDate(ev.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="vendorOpeningReset"
              checked={resetOthersToZero}
              onCheckedChange={(checked) =>
                setResetOthersToZero(checked === true)
              }
            />
            <Label htmlFor="vendorOpeningReset" className="font-normal">
              For each vendor in the file, set items not listed to 0
            </Label>
          </div>
          <FileUploadTooltip hint={FILE_UPLOAD_HINT_VENDOR_OPENING_STOCK}>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() =>
                document.getElementById('vendorOpeningStockInput')?.click()
              }
            >
              Choose Excel / CSV
            </Button>
          </FileUploadTooltip>
          <input
            id="vendorOpeningStockInput"
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
