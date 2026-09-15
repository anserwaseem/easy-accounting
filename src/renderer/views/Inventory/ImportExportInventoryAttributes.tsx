import {
  buildInventoryAttributesAoa,
  parseInventoryAttributesImportRows,
} from '@/renderer/lib/inventoryAttributesImport';
import { FILE_UPLOAD_HINT_INVENTORY_ATTRIBUTES } from '@/renderer/lib/fileUploadTooltips';
import { convertFileToJson } from '@/renderer/lib/lib';
import { DropdownMenuItem } from '@/renderer/shad/ui/dropdown-menu';
import { Input } from '@/renderer/shad/ui/input';
import { toast } from '@/renderer/shad/ui/use-toast';
import { format } from 'date-fns';
import { toString } from 'lodash';
import { useCallback, useRef } from 'react';
import type { AttributeDefinition, InventoryItem } from 'types';
import { write, utils } from 'xlsx';

const EXCEL_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface ImportExportInventoryAttributesProps {
  refetchInventory: () => void | Promise<void>;
}

/** Manage-menu items for inventory attributes spreadsheet import/export */
export const ImportExportInventoryAttributes: React.FC<
  ImportExportInventoryAttributesProps
> = ({ refetchInventory }: ImportExportInventoryAttributesProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(async () => {
    try {
      const [items, definitions] = (await Promise.all([
        window.electron.getInventory(),
        window.electron.getAttributeDefinitions(),
      ])) as [InventoryItem[], AttributeDefinition[]];
      const aoa = buildInventoryAttributesAoa(items, definitions);
      const wb = utils.book_new();
      utils.book_append_sheet(
        wb,
        utils.aoa_to_sheet(aoa),
        'Inventory Attributes',
      );
      const buffer = write(wb, { type: 'array', bookType: 'xlsx' });
      const blob = new Blob([buffer], { type: EXCEL_MIME });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Inventory_Attributes_${format(
        new Date(),
        'yyyy-MM-dd',
      )}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);

      const rowCount = Math.max(aoa.length - 1, 0);
      toast({
        description: `Exported ${rowCount} inventory row${
          rowCount === 1 ? '' : 's'
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
        const definitions =
          (await window.electron.getAttributeDefinitions()) as AttributeDefinition[];
        const json = await convertFileToJson(file, {
          preferDisplayText: true,
        });
        const { patches, skippedRows } = parseInventoryAttributesImportRows(
          json,
          definitions,
        );
        if (patches.length === 0) {
          toast({
            description: `No rows to update${
              skippedRows > 0 ? ` (${skippedRows} skipped)` : ''
            }.`,
            variant: 'destructive',
          });
          return;
        }

        const result = await window.electron.bulkUpdateInventoryAttributeFields(
          patches,
        );
        await refetchInventory();

        toast({
          description: `Attributes: updated ${result.updated} | not found ${result.notFound} | ambiguous ${result.ambiguous} | skipped ${skippedRows}`,
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
        Export attributes
      </DropdownMenuItem>
      <DropdownMenuItem
        title={FILE_UPLOAD_HINT_INVENTORY_ATTRIBUTES}
        onSelect={(event) => {
          event.preventDefault();
          fileInputRef.current?.click();
        }}
      >
        Import attributes
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
