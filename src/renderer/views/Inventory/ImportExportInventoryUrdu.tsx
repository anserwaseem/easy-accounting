import {
  INVENTORY_URDU_EXPORT_HEADERS,
  buildInventoryUrduExportRows,
  parseInventoryUrduImportRows,
} from '@/renderer/lib/inventoryUrduImport';
import { FILE_UPLOAD_HINT_INVENTORY_URDU } from '@/renderer/lib/fileUploadTooltips';
import { convertFileToJson } from '@/renderer/lib/lib';
import { DropdownMenuItem } from '@/renderer/shad/ui/dropdown-menu';
import { Input } from '@/renderer/shad/ui/input';
import { toast } from '@/renderer/shad/ui/use-toast';
import { format } from 'date-fns';
import { toString } from 'lodash';
import { useCallback, useRef } from 'react';
import type { InventoryItem } from 'types';
import { write, utils } from 'xlsx';

const EXCEL_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface ImportExportInventoryUrduProps {
  refetchInventory: () => void | Promise<void>;
}

/** Manage-menu items for inventory Urdu description spreadsheet import/export */
export const ImportExportInventoryUrdu: React.FC<
  ImportExportInventoryUrduProps
> = ({ refetchInventory }: ImportExportInventoryUrduProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(async () => {
    try {
      const items = (await window.electron.getInventory()) as InventoryItem[];
      const rows = buildInventoryUrduExportRows(items);
      const aoa: (string | number)[][] = [
        [...INVENTORY_URDU_EXPORT_HEADERS],
        ...rows.map((row) => [
          row.id,
          row.name,
          row.description,
          row.descriptionUrdu,
        ]),
      ];
      const wb = utils.book_new();
      utils.book_append_sheet(wb, utils.aoa_to_sheet(aoa), 'Inventory Urdu');
      const buffer = write(wb, { type: 'array', bookType: 'xlsx' });
      const blob = new Blob([buffer], { type: EXCEL_MIME });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Inventory_Urdu_Descriptions_${format(
        new Date(),
        'yyyy-MM-dd',
      )}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);

      toast({
        description: `Exported ${rows.length} inventory row${
          rows.length === 1 ? '' : 's'
        }.`,
        variant: 'success',
      });
    } catch (error) {
      toast({
        description: toString(error),
        variant: 'destructive',
      });
    }
  }, []);

  const handleImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      try {
        const json = await convertFileToJson(file, {
          preferDisplayText: true,
        });
        const { patches, skippedRows } = parseInventoryUrduImportRows(json);
        if (patches.length === 0) {
          toast({
            description: `No rows to update${
              skippedRows > 0 ? ` (${skippedRows} skipped)` : ''
            }.`,
            variant: 'destructive',
          });
          return;
        }

        const result = await window.electron.bulkUpdateInventoryUrduFields(
          patches,
        );
        await refetchInventory();

        toast({
          description: `Urdu descriptions: updated ${result.updated} | not found ${result.notFound} | ambiguous ${result.ambiguous} | skipped ${skippedRows}`,
          variant: 'success',
          duration: 8000,
        });
      } catch (error) {
        toast({
          description: toString(error),
          variant: 'destructive',
        });
      } finally {
        e.target.value = '';
      }
    },
    [refetchInventory],
  );

  return (
    <>
      <DropdownMenuItem
        onSelect={() => {
          handleExport();
        }}
      >
        Export Urdu
      </DropdownMenuItem>
      <DropdownMenuItem
        title={FILE_UPLOAD_HINT_INVENTORY_URDU}
        onSelect={(event) => {
          event.preventDefault();
          fileInputRef.current?.click();
        }}
      >
        Import Urdu
      </DropdownMenuItem>
      <Input
        ref={fileInputRef}
        type="file"
        accept=".xlsx, .xls, .csv"
        className="hidden"
        onChange={handleImport}
      />
    </>
  );
};
