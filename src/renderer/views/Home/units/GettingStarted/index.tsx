import { toString } from 'lodash';
import { convertFileToJson } from 'renderer/lib/lib';
import { parseBalanceSheet } from 'renderer/lib/parser';
import { Button } from 'renderer/shad/ui/button';
import { Input } from 'renderer/shad/ui/input';
import { toast } from 'renderer/shad/ui/use-toast';

export const GettingStarted: React.FC = () => {
  const uploadBalanceSheet = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    try {
      const json = await convertFileToJson(file);
      const balanceSheet = parseBalanceSheet(json);
      // eslint-disable-next-line no-console
      console.log(balanceSheet);
      const result = await window.electron.saveBalanceSheet(balanceSheet);
      // eslint-disable-next-line no-console
      console.log('saveBalanceSheet result', result);
      toast({
        description: 'Balance Sheet uploaded successfully.',
        variant: 'success',
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      toast({
        description: toString(error),
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="grid w-full max-w-sm items-center gap-1.5">
      <Button
        variant="outline"
        className="w-full"
        onClick={() =>
          document.getElementById('uploadBalanceSheetInput')?.click()
        }
      >
        Upload Balance Sheet
      </Button>
      <Input
        id="uploadBalanceSheetInput"
        type="file"
        accept=".xlsx, .xls"
        className="hidden"
        onChange={uploadBalanceSheet}
      />
    </div>
  );
};
