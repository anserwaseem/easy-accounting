import { useCallback, useState } from 'react';
import { toast } from '@/renderer/shad/ui/use-toast';
import { ipcErrorMessage } from '@/renderer/lib/ipcUserMessage';
import type { AgentTour, AgentTourInput, SuggestedAgentTour } from 'types';

/** what the tour form edits; chartId comes from the selected agent */
export type TourDraft = Omit<AgentTourInput, 'chartId'>;

/**
 * one agent's tours: list, add/edit/delete, and history suggestions.
 * `onChanged` runs after every successful write so the sheet's tour columns refresh.
 */
export const useAgentTours = (chartId: number, onChanged: () => void) => {
  const [tours, setTours] = useState<AgentTour[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedAgentTour[] | null>(
    null,
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setTours(await window.electron.getAgentTours(chartId));
    } catch (error) {
      console.error('Error loading agent tours:', error);
      toast({
        description: ipcErrorMessage(error),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [chartId]);

  /** runs a write; true when it succeeded and the list reloaded */
  const write = async (
    action: () => Promise<unknown>,
    success: string,
  ): Promise<boolean> => {
    try {
      await action();
    } catch (error) {
      toast({
        title: 'Tour not saved',
        description: ipcErrorMessage(error),
        variant: 'destructive',
      });
      return false;
    }
    toast({ description: success, variant: 'success' });
    await load();
    onChanged();
    return true;
  };

  const saveTour = (draft: TourDraft, id?: number) =>
    write(
      () =>
        id == null
          ? window.electron.insertAgentTour({ ...draft, chartId })
          : window.electron.updateAgentTour(id, { ...draft, chartId }),
      `"${draft.name}" saved`,
    );

  const deleteTour = (tour: AgentTour) =>
    write(
      () => window.electron.deleteAgentTour(tour.id),
      `"${tour.name}" deleted`,
    );

  const suggestTours = async () => {
    try {
      setSuggestions(await window.electron.suggestAgentTours(chartId));
    } catch (error) {
      toast({
        description: ipcErrorMessage(error),
        variant: 'destructive',
      });
    }
  };

  const saveSuggestions = async (drafts: TourDraft[]) => {
    const saved = await write(
      () =>
        window.electron.insertAgentTours(
          drafts.map((draft) => ({ ...draft, chartId })),
        ),
      `${drafts.length} tour${drafts.length === 1 ? '' : 's'} saved`,
    );
    if (saved) setSuggestions(null);
  };

  return {
    tours,
    isLoading,
    load,
    saveTour,
    deleteTour,
    suggestions,
    suggestTours,
    saveSuggestions,
    discardSuggestions: () => setSuggestions(null),
  };
};
