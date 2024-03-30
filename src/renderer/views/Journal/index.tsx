import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from 'renderer/shad/ui/button';

const JournalPage = () => {
  console.log('JournalPage');
  const navigate = useNavigate();

  return (
    <div>
      <div className="flex justify-between items-center py-4 pr-4">
        <h1>Journals</h1>

        <Button
          variant="outline"
          onClick={() => navigate('/journals/new')}
          className="flex items-center"
        >
          <Plus />
          <span>New Journal</span>
        </Button>
      </div>
      <div className="py-10 pr-4">
        {/* <DataTable
          columns={columns}
          data={getJournals()}
          defaultSortField="id"
        /> */}
        show journal table here (with filters - by time, and by isPosted)
      </div>
    </div>
  );
};

export default JournalPage;
