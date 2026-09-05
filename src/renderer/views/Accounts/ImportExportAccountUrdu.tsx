import {
  ACCOUNT_URDU_EXPORT_HEADERS,
  buildAccountUrduExportRows,
  parseAccountUrduImportRows,
} from '@/renderer/lib/accountUrduImport';
import { FILE_UPLOAD_HINT_ACCOUNT_URDU } from '@/renderer/lib/fileUploadTooltips';
import { convertFileToJson } from '@/renderer/lib/lib';
import { DropdownMenuItem } from '@/renderer/shad/ui/dropdown-menu';
import { Input } from '@/renderer/shad/ui/input';
import { toast } from '@/renderer/shad/ui/use-toast';
import { format } from 'date-fns';
import { toString } from 'lodash';
import { useCallback, useRef } from 'react';
import type { Account } from 'types';
import { write, utils } from 'xlsx';

const EXCEL_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface ImportExportAccountUrduProps {
  accounts: Account[];
  refetchAccounts: () => void | Promise<void>;
}

/** Manage-menu items for account Urdu field spreadsheet import/export */
export const ImportExportAccountUrdu: React.FC<
  ImportExportAccountUrduProps
> = ({ accounts, refetchAccounts }: ImportExportAccountUrduProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(() => {
    try {
      const rows = buildAccountUrduExportRows(accounts);
      const aoa: (string | number)[][] = [
        [...ACCOUNT_URDU_EXPORT_HEADERS],
        ...rows.map((row) => [
          row.id,
          row.code,
          row.name,
          row.nameUrdu,
          row.address,
          row.addressUrdu,
          row.goodsName,
          row.goodsNameUrdu,
        ]),
      ];
      const wb = utils.book_new();
      utils.book_append_sheet(wb, utils.aoa_to_sheet(aoa), 'Account Urdu');
      const buffer = write(wb, { type: 'array', bookType: 'xlsx' });
      const blob = new Blob([buffer], { type: EXCEL_MIME });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Account_Urdu_Fields_${format(
        new Date(),
        'yyyy-MM-dd',
      )}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);

      toast({
        description: `Exported ${rows.length} account row${
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
  }, [accounts]);

  const handleImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      try {
        const json = await convertFileToJson(file, {
          preferDisplayText: true,
        });
        const { patches, skippedRows } = parseAccountUrduImportRows(json);
        if (patches.length === 0) {
          toast({
            description: `No rows to update${
              skippedRows > 0 ? ` (${skippedRows} skipped)` : ''
            }.`,
            variant: 'destructive',
          });
          return;
        }

        const result = await window.electron.bulkUpdateAccountUrduFields(
          patches,
        );
        await refetchAccounts();

        toast({
          description: `Urdu fields: updated ${result.updated} | not found ${result.notFound} | ambiguous ${result.ambiguous} | skipped ${skippedRows}`,
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
    [refetchAccounts],
  );

  return (
    <>
      <DropdownMenuItem onSelect={handleExport}>Export Urdu</DropdownMenuItem>
      <DropdownMenuItem
        title={FILE_UPLOAD_HINT_ACCOUNT_URDU}
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
