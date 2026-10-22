import { useParams } from 'react-router-dom';
import { toNumber } from 'lodash';
import { JournalTable } from './journalTable';
import JournalsPage from '../Journals';

const JournalPage: React.FC = () => {
  const { id } = useParams();
  // eslint-disable-next-line no-console
  console.log('JournalPage', id);

  return (
    // Same split as Ledger/Invoice: the list rail is desktop-only, and
    // the detail takes the full width on a phone. This view still had
    // the bare `flex flex-row` / `w-1/4` layout, which left the journal
    // list 97px wide on a 390px screen.
    <div className="flex flex-col md:flex-row h-screen">
      <div className="hidden md:block md:w-1/4 overflow-y-scroll scrollbar">
        <JournalsPage isMini />
      </div>
      <div className="w-full md:w-3/4 data-detail-scroll overflow-y-auto scrollbar justify-between items-center px-3 py-4 md:px-4 md:py-5 md:pl-8">
        <JournalTable journalId={toNumber(id)} />
      </div>
    </div>
  );
};

export default JournalPage;
