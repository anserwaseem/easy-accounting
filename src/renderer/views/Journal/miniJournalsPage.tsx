import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from 'renderer/shad/ui/button';
import {
  currencyFormatOptions,
  dateFormatOptions,
} from 'renderer/lib/constants';
import { Table, TableBody, TableCell, TableRow } from 'renderer/shad/ui/table';
import { Separator } from 'renderer/shad/ui/separator';

export const MiniJournalsPage: React.FC = () => {
  console.log('MiniJournalsPage');
  const [journals, setJounrals] = useState<(Journal & { amount: number })[]>(
    [],
  );

  const navigate = useNavigate();

  useEffect(
    () =>
      void (async () =>
        setJounrals(
          ((await window.electron.getJournals()) as Journal[]).map(
            (journal) => ({
              ...journal,
              amount: journal.journalEntries.reduce(
                (acc, entry) => acc + entry.debitAmount,
                0,
              ),
            }),
          ),
        ))(),
    [],
  );

  return (
    <div>
      <div className="flex justify-between items-center py-4 pr-4">
        <h1 className="text-xl">Journals</h1>

        <Button
          variant="outline"
          onClick={() => navigate('/journals/new')}
          className="flex items-center"
        >
          <Plus />
          <span>New Journal</span>
        </Button>
      </div>

      <Separator />

      <div className="py-10 pr-4">
        <Table>
          <TableBody>
            {journals.map((journal) => (
              <TableRow key={journal.id}>
                <TableCell>
                  <div className="flex justify-between">
                    <div className="flex flex-col">
                      <p>
                        {new Date(journal.date || '').toLocaleString(
                          'en-US',
                          dateFormatOptions,
                        )}
                      </p>
                      <p>{journal.id}</p>
                    </div>
                    <div className="flex flex-col">
                      <p>
                        {Intl.NumberFormat(
                          'en-US',
                          currencyFormatOptions,
                        ).format(
                          journal?.journalEntries.reduce(
                            (acc, entry) => acc + entry.debitAmount,
                            0,
                          ) || 0,
                        )}
                      </p>
                      <p className="text-end text-green-600">
                        {journal.isPosted ? 'Posted' : 'Draft'}
                      </p>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
