import { useState } from 'react';
import { format } from 'date-fns';
import { History, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/renderer/shad/ui/sheet';
import { useMountEffect } from '@/renderer/hooks/useMountEffect';
import type { AgentTour, Chart } from 'types';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/renderer/shad/ui/tabs';
import { formatBillDate } from '../buildCollectionSheetRows';
import { CollectionSourcesReview } from './CollectionSourcesReview';
import type { SheetRange } from './useCollectionSources';
import { SuggestedToursReview } from './SuggestedToursReview';
import { TourForm } from './TourForm';
import { useAgentTours, type TourDraft } from './useAgentTours';

interface ToursSheetProps {
  head: Chart;
  /** the sheet's loaded range; null until a sheet has loaded */
  range: SheetRange | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToursChanged: () => void;
}

interface ToursPanelProps {
  head: Chart;
  onToursChanged: () => void;
}

const newTourDraft = (): TourDraft => {
  const today = new Date();
  return {
    name: format(today, 'MMM yyyy'),
    startDate: format(today, 'yyyy-MM-dd'),
    endDate: null,
    notes: null,
  };
};

const toDraft = (tour: AgentTour): TourDraft => ({
  name: tour.name,
  startDate: tour.startDate,
  endDate: tour.endDate,
  notes: tour.notes ?? null,
});

/** mounted only while the sheet is open, so each open reloads the list */
const ToursPanel: React.FC<ToursPanelProps> = ({
  head,
  onToursChanged,
}: ToursPanelProps) => {
  const {
    tours,
    isLoading,
    load,
    saveTour,
    deleteTour,
    suggestions,
    suggestTours,
    saveSuggestions,
    discardSuggestions,
  } = useAgentTours(head.id, onToursChanged);
  const [editingId, setEditingId] = useState<number | null>(null);

  useMountEffect(() => {
    load().catch((error) => console.error('Error loading tours:', error));
  });

  const editing = tours.find((tour) => tour.id === editingId);

  return (
    <div className="mt-4 space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">
          {editing ? `Edit "${editing.name}"` : 'New tour'}
        </h3>
        {editing ? (
          <TourForm
            key={editing.id}
            initial={toDraft(editing)}
            submitLabel="Save changes"
            onSubmit={async (draft) => {
              const saved = await saveTour(draft, editing.id);
              if (saved) setEditingId(null);
              return saved;
            }}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <TourForm
            key="new"
            initial={newTourDraft()}
            submitLabel="Add tour"
            onSubmit={(draft) => saveTour(draft)}
          />
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">History</h3>
          {suggestions == null ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                suggestTours().catch((error) =>
                  console.error('Error suggesting tours:', error),
                );
              }}
            >
              <History className="mr-1 h-4 w-4" />
              Suggest from history
            </Button>
          ) : null}
        </div>
        {suggestions != null ? (
          <SuggestedToursReview
            suggestions={suggestions}
            onSave={saveSuggestions}
            onDiscard={discardSuggestions}
          />
        ) : null}
        {!isLoading && tours.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tours yet.</p>
        ) : null}
        {tours.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Name</th>
                <th className="py-2 pr-2 font-medium">Start</th>
                <th className="py-2 pr-2 font-medium">End</th>
                <th className="py-2" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {tours.map((tour) => (
                <tr key={tour.id} className="border-b last:border-0">
                  <td className="py-1.5 pr-2" title={tour.notes ?? undefined}>
                    {tour.name}
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums">
                    {formatBillDate(tour.startDate)}
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums">
                    {tour.endDate ? formatBillDate(tour.endDate) : 'running'}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Edit"
                      onClick={() => setEditingId(tour.id)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Delete"
                      onClick={() => {
                        if (editingId === tour.id) setEditingId(null);
                        deleteTour(tour).catch((error) =>
                          console.error('Error deleting tour:', error),
                        );
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
};

/** agent tours manager. keyed by head so switching agent starts clean */
export const ToursSheet: React.FC<ToursSheetProps> = ({
  head,
  range,
  open,
  onOpenChange,
  onToursChanged,
}: ToursSheetProps) => (
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
      <SheetHeader className="pr-10">
        <SheetTitle>Tours · {head.name}</SheetTitle>
        <SheetDescription>
          A payment belongs to the tour whose dates include the journal date.
          Tours of one agent cannot overlap.
        </SheetDescription>
      </SheetHeader>
      {open ? (
        <Tabs key={head.id} defaultValue="tours" className="mt-4">
          <TabsList>
            <TabsTrigger value="tours">Tours</TabsTrigger>
            <TabsTrigger value="sources">What counts as payment</TabsTrigger>
          </TabsList>
          <TabsContent value="tours">
            <ToursPanel head={head} onToursChanged={onToursChanged} />
          </TabsContent>
          <TabsContent value="sources">
            {range ? (
              <CollectionSourcesReview
                key={`${range.from}:${range.to}`}
                chartId={head.id}
                range={range}
                onChanged={onToursChanged}
              />
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Load the sheet for a date range first.
              </p>
            )}
          </TabsContent>
        </Tabs>
      ) : null}
    </SheetContent>
  </Sheet>
);
