import { useState } from 'react';
import { Button } from '@/renderer/shad/ui/button';
import { Input } from '@/renderer/shad/ui/input';
import { Label } from '@/renderer/shad/ui/label';
import type { TourDraft } from './useAgentTours';

interface TourFormProps {
  initial: TourDraft;
  submitLabel: string;
  onSubmit: (draft: TourDraft) => Promise<boolean>;
  onCancel?: () => void;
}

/** remount with a new key to load another tour; state is local until submit */
export const TourForm: React.FC<TourFormProps> = ({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: TourFormProps) => {
  const [draft, setDraft] = useState<TourDraft>(initial);
  const [isSaving, setIsSaving] = useState(false);

  const set = (patch: Partial<TourDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    const saved = await onSubmit({
      ...draft,
      endDate: draft.endDate || null,
      notes: draft.notes || null,
    });
    setIsSaving(false);
    if (saved && !onCancel) setDraft(initial);
  };

  return (
    <form className="grid grid-cols-2 gap-3" onSubmit={handleSubmit}>
      <div className="col-span-2 space-y-1">
        <Label htmlFor="tour-name">Name</Label>
        <Input
          id="tour-name"
          value={draft.name}
          onChange={(event) => set({ name: event.target.value })}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tour-start">Start</Label>
        <Input
          id="tour-start"
          type="date"
          value={draft.startDate}
          onChange={(event) => set({ startDate: event.target.value })}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tour-end">End</Label>
        <Input
          id="tour-end"
          type="date"
          value={draft.endDate ?? ''}
          min={draft.startDate}
          onChange={(event) => set({ endDate: event.target.value || null })}
        />
        <p className="text-xs text-muted-foreground">
          Leave empty while the agent is still out.
        </p>
      </div>
      <div className="col-span-2 space-y-1">
        <Label htmlFor="tour-notes">Notes</Label>
        <Input
          id="tour-notes"
          value={draft.notes ?? ''}
          onChange={(event) => set({ notes: event.target.value })}
        />
      </div>
      <div className="col-span-2 flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={isSaving}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
};
