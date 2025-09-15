import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toNumber } from 'lodash';
import type { Account, LedgerView } from '@/types';
import { getFormattedCurrency } from '@/renderer/lib/utils';
import { LedgerTableBase } from '@/renderer/components/ledger/LedgerTableBase';
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

  return (
    <div className="flex flex-row h-screen">
      <div className="w-1/4 overflow-y-scroll scrollbar">
        <AccountsPage isMini onRowClick={onRowClick} />
      </div>
      <div className="w-3/4 overflow-y-auto scrollbar justify-between items-center px-4 py-5">
        <div className="grid grid-cols-3 items-center">
          <p className="text-sm text-slate-400">{headName}</p>
          <h1 className="text-2xl font-semibold row-start-2">{accountName}</h1>
          <h1 className="text-2xl text-center mb-auto row-span-2">Ledger</h1>
          {ledger.length ? (
            <div className="flex gap-2 row-span-2 items-center justify-self-end">
              <h3 className="text-center mb-auto">Balance:</h3>
              <h3>
                <span className="font-bold">
                  {getFormattedCurrency(ledger[ledger.length - 1].balance)}{' '}
                </span>
                {ledger[ledger.length - 1].balanceType}
              </h3>
            </div>
          ) : null}
        </div>
        <LedgerTableBase ledger={ledger} printMode={false} className="py-8" />
      </div>
    </div>
  );
};

export default LedgerPage;
