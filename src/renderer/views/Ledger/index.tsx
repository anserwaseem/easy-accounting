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
      <div className="w-full md:w-3/4 data-detail-scroll overflow-y-auto scrollbar justify-between items-center px-3 py-4 md:px-4 md:py-5">
        {/* The heading was a three-column grid — account name, the word
            "Ledger", then the balance — which on a phone put the title
            in the middle of the screen and the balance on a third row.
            The account name and the balance now share the first row and
            the balance drops below it on a narrow screen. */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground break-words">
                {headName}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="title-new break-words">{accountName}</h1>
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

            {ledger.length ? (
              <div className="shrink-0 text-right">
                <p className="text-sm text-muted-foreground">Balance</p>
                <p className="text-lg font-semibold tabular-nums">
                  {getFormattedCurrency(ledger[ledger.length - 1].balance)}{' '}
                  <span className="text-sm font-normal">
                    {ledger[ledger.length - 1].balanceType}
                  </span>
                </p>
              </div>
            ) : null}
          </div>
        </div>
        <LedgerTableBase ledger={ledger} printMode={false} className="py-8" />
      </div>
    </div>
  );
};

export default LedgerPage;
