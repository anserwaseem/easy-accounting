import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { toNumber } from 'lodash';
import { MiniAccountPage } from './miniAccountPage';
import { LedgerTable } from './ledgerTable';

const LedgerPage = () => {
  const { id } = useParams();
  const [accountName, setAccountName] = useState('');
  const [headName, setHeadName] = useState('');
  console.log('LedgerPage', id);

  return (
    <div className="flex flex-row h-screen">
      <div className="w-1/4 overflow-y-scroll scrollbar">
        <MiniAccountPage
          accountId={toNumber(id)}
          setAccountName={setAccountName}
          setHeadName={setHeadName}
        />
      </div>
      <div className="w-3/4 overflow-y-auto scrollbar justify-between items-center p-4">
        <div>
          <p className="text-sm text-slate-400">{headName}</p>
          <h1 className="text-2xl font-semibold">{accountName}</h1>
        </div>
        <LedgerTable accountId={toNumber(id)} />
      </div>
    </div>
  );
};

export default LedgerPage;
