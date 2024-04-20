import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { toNumber } from 'lodash';
import { MiniJournalsPage } from './miniJournalsPage';
import { JournalTable } from './journalTable';

const JournalPage = () => {
  const { id } = useParams();
  const [accountName, setAccountName] = useState('');
  const [headName, setHeadName] = useState('');
  console.log('JournalPage', id);

  return (
    <div className="flex flex-row h-screen">
      <div className="w-1/4 overflow-y-auto scrollbar">
        <MiniJournalsPage />
      </div>
      <div className="w-3/4 overflow-y-auto scrollbar justify-between items-center p-4">
        <div>
          <p className="text-sm text-slate-400">{headName}</p>
          <h1 className="text-2xl font-semibold">{accountName}</h1>
        </div>
        <JournalTable journalId={toNumber(id)} />
      </div>
    </div>
  );
};

export default JournalPage;
