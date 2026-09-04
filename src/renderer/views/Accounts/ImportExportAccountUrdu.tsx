import { FileUploadTooltip } from '@/renderer/components/FileUploadTooltip';
import {
  ACCOUNT_URDU_EXPORT_HEADERS,
  buildAccountUrduExportRows,
  parseAccountUrduImportRows,
} from '@/renderer/lib/accountUrduImport';
import { FILE_UPLOAD_HINT_ACCOUNT_URDU } from '@/renderer/lib/fileUploadTooltips';
import { convertFileToJson } from '@/renderer/lib/lib';
import { Button } from '@/renderer/shad/ui/button';
import { Input } from '@/renderer/shad/ui/input';
import { toast } from '@/renderer/shad/ui/use-toast';
import { format } from 'date-fns';
import { Download, Upload } from 'lucide-react';
import { toString } from 'lodash';
import { useCallback } from 'react';
import type { Account } from 'types';
import { write, utils } from 'xlsx';

const EXCEL_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const ACCOUNT_URDU_IMPORT_INPUT_ID = 'importAccountUrduInput';

interface ImportExportAccountUrduProps {
  accounts: Account[];
  refetchAccounts: () => void | Promise<void>;
}

export const ImportExportAccountUrdu: React.FC<
  ImportExportAccountUrduProps
> = ({ accounts, refetchAccounts }: ImportExportAccountUrduProps) => {
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="px-3"
        title="Export account Urdu fields to Excel"
        onClick={handleExport}
      >
        <Download size={16} className="mr-1.5" />
        Export Urdu
      </Button>
      <FileUploadTooltip content={FILE_UPLOAD_HINT_ACCOUNT_URDU}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="px-3"
          title="Import account Urdu fields from Excel"
          onClick={() =>
            document.getElementById(ACCOUNT_URDU_IMPORT_INPUT_ID)?.click()
          }
        >
          <Upload size={16} className="mr-1.5" />
          Import Urdu
        </Button>
      </FileUploadTooltip>
      <Input
        id={ACCOUNT_URDU_IMPORT_INPUT_ID}
        type="file"
        accept=".xlsx, .xls, .csv"
        className="hidden"
        onChange={handleImport}
      />
    </>
  );
};
