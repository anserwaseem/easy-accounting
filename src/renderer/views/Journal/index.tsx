import { useParams } from 'react-router-dom';
import { toNumber } from 'lodash';
import { JournalTable } from './journalTable';
import JournalsPage from '../Journals';

const JournalPage = () => {
  const { id } = useParams();
  console.log('JournalPage', id);

  return (
    <div className="flex flex-row h-screen">
      <div className="w-1/4 overflow-y-scroll scrollbar">
        <JournalsPage isMini={true} />
      </div>
      <div className="w-3/4 overflow-y-auto scrollbar justify-between items-center p-4 pl-8">
        <JournalTable journalId={toNumber(id)} />
      </div>
    </div>
  );
};

export default JournalPage;
