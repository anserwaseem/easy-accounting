import { useMemo, useState } from 'react';
import { PackageOpen } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { Input } from '@/renderer/shad/ui/input';
import { Label } from '@/renderer/shad/ui/label';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import type { VendorStockOpeningRow } from 'types';

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
  const [previewRows, setPreviewRows] = useState<VendorStockOpeningRow[]>([]);
  const [importing, setImporting] = useState(false);

  const previewSummary = useMemo(() => {
    const vendors = new Set(
      previewRows.map(
        (r) => r.vendorCode || r.vendorName || '',
      ).filter(Boolean),
    );
    return {
      rowCount: previewRows.length,
      vendorCount: vendors.size,
    };
  }, [previewRows]);

  const resetDialog = () => {
    setPreviewRows([]);
    setResetOthersToZero(false);
    setAsOfDate(today);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) resetDialog();
  };

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
        setPreviewRows([]);
        return;
      }
      setPreviewRows(rows);
    } catch (err) {
      toast({
        description: toString(err),
        variant: 'destructive',
      });
      setPreviewRows([]);
    }
    e.target.value = '';
  };

  const handleConfirmImport = async () => {
    if (!previewRows.length) return;
    setImporting(true);
    try {
      const result = await window.electron.importVendorOpeningStock(
        previewRows,
        asOfDate || today,
        resetOthersToZero,
      );
      if (result.success) {
        onImported?.();
        handleOpenChange(false);
        toast({
          description: `Starting qty set for ${previewSummary.rowCount} rows across ${previewSummary.vendorCount} vendor(s).`,
          variant: 'success',
        });
      } else {
        toast({
          description: result.error ?? 'Failed to import starting qty',
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        description: toString(err),
        variant: 'destructive',
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PackageOpen size={16} className="mr-1.5" />
          Set starting qty
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Set starting qty at vendors</DialogTitle>
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
          <div className="flex items-start gap-2">
            <Checkbox
              id="vendorOpeningReset"
              checked={resetOthersToZero}
              onCheckedChange={(checked) =>
                setResetOthersToZero(checked === true)
              }
            />
            <Label htmlFor="vendorOpeningReset" className="font-normal">
              For each vendor in the file, set items not listed to 0
              {resetOthersToZero ? (
                <span className="mt-1 block text-destructive">
                  Warning: other items at those vendors will be zeroed.
                </span>
              ) : null}
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
              {previewRows.length ? 'Choose a different file' : 'Choose Excel / CSV'}
            </Button>
          </FileUploadTooltip>
          <input
            id="vendorOpeningStockInput"
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFileChange}
          />

          {previewRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Preview: {previewSummary.rowCount} rows,{' '}
                {previewSummary.vendorCount} vendor(s). Nothing written yet.
              </p>
              <div className="max-h-48 overflow-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">Vendor</th>
                      <th className="px-2 py-1 text-left font-medium">Item</th>
                      <th className="px-2 py-1 text-right font-medium">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 50).map((row, index) => (
                      // preview rows have no stable id; index is fine for ephemeral list
                      // eslint-disable-next-line react/no-array-index-key
                      <tr key={`${row.name}-${index}`} className="border-t">
                        <td className="px-2 py-1">
                          {row.vendorCode || row.vendorName}
                        </td>
                        <td className="px-2 py-1">{row.name}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {row.quantity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {previewRows.length > 50 && (
                <p className="text-xs text-muted-foreground">
                  Showing first 50 of {previewRows.length} rows.
                </p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={importing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmImport}
            disabled={!previewRows.length || importing}
          >
            Confirm import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
