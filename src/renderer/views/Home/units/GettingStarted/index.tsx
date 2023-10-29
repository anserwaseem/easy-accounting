import { Button } from 'renderer/shad/ui/button';
import { Input } from 'renderer/shad/ui/input';
import { read, utils } from 'xlsx';

export const GettingStarted = () => {
  const uploadBalanceSheet = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const data = await file.arrayBuffer();
    // parse
    const wb = read(data);
    // get the first worksheet
    const ws = wb.Sheets[wb.SheetNames[0]];
    // convert to json
    const json = utils.sheet_to_json(ws, { header: 1 });
    console.log(json);
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
        {' '}
        Upload Balance Sheet{' '}
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
