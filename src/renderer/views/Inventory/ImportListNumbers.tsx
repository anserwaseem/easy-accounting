import { FileUploadTooltip } from '@/renderer/components/FileUploadTooltip';
import { FILE_UPLOAD_HINT_LIST_POSITION_IMPORT } from '@/renderer/lib/fileUploadTooltips';
import { convertFileToJson } from '@/renderer/lib/lib';
import { parseInventoryListPositionRows } from '@/renderer/lib/parser';
import { Button } from '@/renderer/shad/ui/button';
import { Input } from '@/renderer/shad/ui/input';
import { toast } from '@/renderer/shad/ui/use-toast';
import { ListOrdered } from 'lucide-react';
import { take, toString, uniq } from 'lodash';
import { useCallback } from 'react';

const MAX_NAMES_SHOWN = 25;

/** unique preserve order, then cap list for toast width */
const summarizeNamesForToast = (names: string[]): string => {
  const u = uniq(names);
  const shown = take(u, MAX_NAMES_SHOWN);
  const more = u.length - shown.length;
  const body = shown.join(', ');
  return more > 0 ? `${body} (+${more} more)` : body;
};

interface ImportListNumbersProps {
  refetchInventory: () => void;
}

export const ImportListNumbers: React.FC<ImportListNumbersProps> = ({
  refetchInventory,
}: ImportListNumbersProps) => {
  const onFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      try {
        const json = await convertFileToJson(file, {
          preferDisplayText: true,
        });
        const rows = parseInventoryListPositionRows(json);
        const result = await window.electron.applyInventoryListPositions(rows);
        refetchInventory();
        toast({
          description: (
            <div className="space-y-1.5 text-sm">
              <p>
                List #: updated {result.updated}&nbsp;
                {result.notFoundNames.length > 0
                  ? `| not found: ${result.notFoundNames.length}`
                  : ''}
                &nbsp;
                {result.ambiguousNames.length > 0
                  ? `| duplicate names skipped: ${result.ambiguousNames.length}`
                  : ''}
              </p>
              {result.notFoundNames.length > 0 && (
                <p className="break-words">
                  <span className="font-medium">Not in catalog:</span>&nbsp;
                  {summarizeNamesForToast(result.notFoundNames)}
                </p>
              )}
              {result.ambiguousNames.length > 0 && (
                <p className="break-words">
                  <span className="font-medium">
                    Duplicate names (skipped):
                  </span>
                  &nbsp;
                  {summarizeNamesForToast(result.ambiguousNames)}
                </p>
              )}
            </div>
          ),
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
      <FileUploadTooltip content={FILE_UPLOAD_HINT_LIST_POSITION_IMPORT}>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() =>
            document.getElementById('importListNumbersInput')?.click()
          }
        >
          <ListOrdered size={16} className="mr-1.5" />
          Import list #
        </Button>
      </FileUploadTooltip>
      <Input
        id="importListNumbersInput"
        type="file"
        accept=".xlsx, .xls, .csv"
        className="hidden"
        onChange={onFile}
      />
    </>
  );
};
