import { toString } from 'lodash';
import { Info } from 'lucide-react';
import { convertFileToJson } from 'renderer/lib/lib';
import { parseBalanceSheet } from 'renderer/lib/parser';
import { Button } from 'renderer/shad/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from 'renderer/shad/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/renderer/shad/ui/alert';
import { Input } from 'renderer/shad/ui/input';
import { toast } from 'renderer/shad/ui/use-toast';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SetOpeningStock } from '../../Inventory/SetOpeningStock';

export const GettingStarted: React.FC = () => {
  const navigate = useNavigate();
  const [isDismissed, setIsDismissed] = useState<boolean>(
    window.electron.store.get('gettingStartedDismissed') === true,
  );

  const shouldShow = useMemo(() => !isDismissed, [isDismissed]);

  const uploadBalanceSheet = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
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
      } finally {
        e.target.value = '';
      }
    },
    [],
  );

  if (!shouldShow) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2">
        <div className="text-sm text-muted-foreground">
          Getting started is hidden.
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            window.electron.store.set('gettingStartedDismissed', false);
            setIsDismissed(false);
          }}
        >
          Show again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          Getting started
        </h2>
        <p className="text-sm text-muted-foreground">
          Pick the path that matches your situation. You can do these steps in
          any order.
        </p>
      </div>

      <Alert variant="warning">
        <Info />
        <div className="flex w-full flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <AlertTitle>Already using the system?</AlertTitle>
            <AlertDescription>
              You can ignore these onboarding tools. Don’t use opening stock
              unless you’re setting your starting quantities (or restating them
              intentionally).
            </AlertDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => {
              window.electron.store.set('gettingStartedDismissed', true);
              setIsDismissed(true);
            }}
          >
            Hide
          </Button>
        </div>
      </Alert>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Moving from another system
            </CardTitle>
            <CardDescription>
              Bring your opening balances and starting stock so your reports and
              invoices line up from day one.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              Recommended: upload your balance sheet first, then set opening
              stock as of the same date.
            </div>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                document.getElementById('uploadBalanceSheetInput')?.click()
              }
            >
              Upload balance sheet
            </Button>
            <SetOpeningStock />
            <Input
              id="uploadBalanceSheetInput"
              type="file"
              accept=".xlsx, .xls"
              className="hidden"
              onChange={uploadBalanceSheet}
            />
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Starting a new business</CardTitle>
            <CardDescription>
              Set up your chart of accounts and inventory so your first invoices
              and journals are clean and consistent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div>
              If you don’t have inventory yet, you can skip opening stock and
              start recording purchases/sales normally.
            </div>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate('/accounts')}>
              Go to accounts
            </Button>
            <Button variant="outline" onClick={() => navigate('/inventory')}>
              Go to inventory
            </Button>
            <Button onClick={() => navigate('/sale/invoices/new')}>
              Create first sale invoice
            </Button>
          </CardFooter>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Integrations & transfers</CardTitle>
            <CardDescription>
              This app is optimized for fast Excel-based onboarding. If you’re
              transferring data from another tool, export to Excel first. Then
              import the key starting points.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="text-sm font-medium">Opening balances</div>
              <div className="text-sm text-muted-foreground">
                Upload a balance sheet to seed your accounts and reporting.
              </div>
            </div>
            <div className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="text-sm font-medium">Opening stock</div>
              <div className="text-sm text-muted-foreground">
                Set item quantities as of a date before you record invoices.
              </div>
            </div>
            <div className="rounded-md border bg-muted/20 px-3 py-2">
              <div className="text-sm font-medium">Ongoing operations</div>
              <div className="text-sm text-muted-foreground">
                After onboarding, record purchases/sales and journals inside the
                app to keep everything consistent.
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate('/settings')}>
              Open settings
            </Button>
            <Button variant="outline" onClick={() => navigate('/reports')}>
              View reports
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
};
