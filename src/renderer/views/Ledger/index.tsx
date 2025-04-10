import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toNumber } from 'lodash';
import { Printer } from 'lucide-react';
import type { Account, LedgerView } from '@/types';
import { getFormattedCurrency } from '@/renderer/lib/utils';
import { Button } from 'renderer/shad/ui/button';
import { printStyles } from '../Reports/components';
import { LedgerTable } from './ledgerTable';
import AccountsPage from '../Accounts';

const LedgerPage: React.FC = () => {
  const { id } = useParams();
  const [accountName, setAccountName] = useState('');
  const [headName, setHeadName] = useState('');
  const [ledger, setLedger] = useState<LedgerView[]>([]);
  // eslint-disable-next-line no-console
  console.log('LedgerPage', id);

  useEffect(() => {
    (async () => setLedger(await window.electron.getLedger(toNumber(id))))();
  }, [id]);

  const onRowClick = async (accountId?: number) => {
    const accounts = (await window.electron.getAccounts()) as Account[];
    const selectedAccount = accounts.find(
      (account) => account.id === toNumber(accountId ?? id),
    );
    setAccountName(selectedAccount?.name || '');
    setHeadName(selectedAccount?.headName || '');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      <style>{printStyles}</style>
      <div className="flex flex-row h-screen print-container">
        <div className="w-1/4 overflow-y-scroll scrollbar print:hidden">
          <AccountsPage isMini onRowClick={onRowClick} />
        </div>
        <div className="w-3/4 overflow-y-auto scrollbar justify-between items-center px-4 py-5">
          {/* Header Section */}
          <div className="flex justify-between items-center mb-6">
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">{headName}</p>
              <h1 className="text-2xl font-semibold">{accountName}</h1>
            </div>
            <div className="flex-1 text-center">
              <h1 className="text-2xl font-semibold">Ledger</h1>
            </div>
            <div className="flex-1 flex items-center justify-end gap-4">
              {ledger.length ? (
                <>
                  <div className="flex flex-col items-end">
                    <span className="text-sm text-muted-foreground">
                      Balance:
                    </span>
                    <span className="font-semibold">
                      {getFormattedCurrency(ledger[ledger.length - 1].balance)}{' '}
                      {ledger[ledger.length - 1].balanceType}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handlePrint}
                    title="Print Ledger"
                    className="print:hidden"
                  >
                    <Printer className="h-4 w-4" />
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          {/* Table Section */}
          <div className="print-card">
            <LedgerTable ledger={ledger} />
          </div>
        </div>
      </div>
    </>
  );
};

export default LedgerPage;
