import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toNumber } from 'lodash';
import type { Account, LedgerView } from '@/types';
import { getFormattedCurrency } from '@/renderer/lib/utils';
import { LedgerTableBase } from '@/renderer/components/ledger/LedgerTableBase';
import { Badge } from '@/renderer/shad/ui/badge';
import AccountsPage from '../Accounts';

const LedgerPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [accountName, setAccountName] = useState('');
  const [accountCode, setAccountCode] = useState<number | string>('');
  const [headName, setHeadName] = useState('');
  const [ledger, setLedger] = useState<LedgerView[]>([]);

  const onRowClick = useCallback(
    (accountId?: number) => {
      if (accountId) {
        navigate(`/ledger/${accountId}`);
      }
    },
    [navigate],
  );

  useEffect(() => {
    const accountId = toNumber(id);
    if (!accountId) return;
    let isCurrent = true;

    const fetchLedgerData = async () => {
      try {
        const [fetchedLedger, accounts] = await Promise.all([
          window.electron.getLedger(accountId),
          window.electron.getAccountsByIds([accountId]),
        ]);
        if (!isCurrent) return;

        setLedger(fetchedLedger ?? []);
        const selectedAccount = (accounts as Account[] | undefined)?.[0];
        if (selectedAccount) {
          setAccountName(selectedAccount.name || '');
          setHeadName(selectedAccount.headName || '');
          setAccountCode(selectedAccount.code ?? '');
        }
      } catch (error) {
        console.error('Error fetching ledger details:', error);
      }
    };

    fetchLedgerData();

    return () => {
      isCurrent = false;
    };
  }, [id]);

  return (
    <div className="flex flex-col md:flex-row h-[100dvh]">
      {/* Account-switcher mini rail — desktop only. On mobile the sidebar's
          own Accounts link already covers switching accounts, and the
          space is better spent on the ledger itself. */}
      <div className="hidden md:block md:w-1/4 overflow-y-scroll scrollbar">
        <AccountsPage isMini onRowClick={onRowClick} />
      </div>
      {/* `data-detail-scroll` is an attribute, not a class name: it is
          how ScrollToTopButton finds this pane as the screen's real
          scroller. */}
      <div
        data-detail-scroll
        className="w-full md:w-3/4 overflow-y-auto scrollbar justify-between items-center px-3 py-4 md:px-4 md:py-5"
      >
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
