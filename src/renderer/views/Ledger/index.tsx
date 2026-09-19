import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toNumber } from 'lodash';
import type { Account, LedgerView } from '@/types';
import { getFormattedCurrency } from '@/renderer/lib/utils';
import { LedgerTableBase } from '@/renderer/components/ledger/LedgerTableBase';
import { Badge } from '@/renderer/shad/ui/badge';
import AccountsPage from '../Accounts';

const LedgerPage: React.FC = () => {
  const { id } = useParams();
  const [accountName, setAccountName] = useState('');
  const [accountCode, setAccountCode] = useState<number | string>('');
  const [headName, setHeadName] = useState('');
  const [ledger, setLedger] = useState<LedgerView[]>([]);
  // eslint-disable-next-line no-console
  console.log('LedgerPage', id);

  const onRowClick = async (accountId?: number) => {
    const accounts = (await window.electron.getAccounts()) as Account[];
    const selectedAccount = accounts.find(
      (account) => account.id === toNumber(accountId ?? id),
    );
    setAccountName(selectedAccount?.name || '');
    setHeadName(selectedAccount?.headName || '');
    setAccountCode(selectedAccount?.code ?? '');
  };

  useEffect(() => {
    (async () => setLedger(await window.electron.getLedger(toNumber(id))))();
  }, [id]);

  return (
    <div className="flex flex-col md:flex-row h-screen">
      {/* Account-switcher mini rail — desktop only. On mobile the sidebar's
          own Accounts link already covers switching accounts, and the
          space is better spent on the ledger itself. */}
      <div className="hidden md:block md:w-1/4 overflow-y-scroll scrollbar">
        <AccountsPage isMini onRowClick={onRowClick} />
      </div>
      <div className="w-full md:w-3/4 overflow-y-auto scrollbar justify-between items-center px-3 py-4 md:px-4 md:py-5">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-start gap-x-4 gap-y-2">
          <div>
            <p className="text-sm text-slate-400 whitespace-normal break-words">
              {headName}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="title-new whitespace-normal break-words">
                {accountName}
              </h1>
              {accountCode ? (
                <Badge
                  variant="secondary"
                  className="whitespace-nowrap font-medium"
                >
                  {accountCode}
                </Badge>
              ) : null}
            </div>
          </div>

          <h1 className="text-2xl text-center">Ledger</h1>

          {ledger.length ? (
            <div className="flex gap-2 items-center justify-self-end">
              <h3 className="text-center">Balance:</h3>
              <h3>
                <span className="font-bold">
                  {getFormattedCurrency(ledger[ledger.length - 1].balance)}{' '}
                </span>
                {ledger[ledger.length - 1].balanceType}
              </h3>
            </div>
          ) : (
            <div />
          )}
        </div>
        <LedgerTableBase ledger={ledger} printMode={false} className="py-8" />
      </div>
    </div>
  );
};

export default LedgerPage;
