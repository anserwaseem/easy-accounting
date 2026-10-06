import { useState } from 'react';
import { Button } from '@/renderer/shad/ui/button';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Input } from '@/renderer/shad/ui/input';
import type { SuggestedAgentTour } from 'types';
import { BULK_RECEIPT_MIN_CREDIT_LINES } from '@/core/utils/suggestAgentTours';
import type { TourDraft } from './useAgentTours';

interface SuggestedToursReviewProps {
  suggestions: SuggestedAgentTour[];
  onSave: (drafts: TourDraft[]) => Promise<void>;
  onDiscard: () => void;
}

interface ReviewRow extends TourDraft {
  key: number;
  include: boolean;
  creditLines: number;
}

/** editable proposals; nothing is written until "Save selected" */
export const SuggestedToursReview: React.FC<SuggestedToursReviewProps> = ({
  suggestions,
  onSave,
  onDiscard,
}: SuggestedToursReviewProps) => {
  const [rows, setRows] = useState<ReviewRow[]>(() =>
    suggestions.map((suggestion) => ({
      key: suggestion.journalId,
      include: true,
      name: suggestion.name,
      startDate: suggestion.startDate,
      endDate: suggestion.endDate,
      notes: null,
      creditLines: suggestion.creditLines,
    })),
  );
  const [isSaving, setIsSaving] = useState(false);

  if (suggestions.length === 0) {
    return (
      <div className="space-y-2 rounded-md border p-3 text-sm">
        <p>
          No pattern found: this agent has no journals that settle{' '}
          {BULK_RECEIPT_MIN_CREDIT_LINES} or more shops at once against cash,
          bank or a clearing account. Add tours by hand.
        </p>
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          Close
        </Button>
      </div>
    );
  }

  const patch = (key: number, change: Partial<ReviewRow>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...change } : row)),
    );
  const selected = rows.filter((row) => row.include);

  const handleSave = async () => {
    setIsSaving(true);
    await onSave(
      selected.map(({ name, startDate, endDate, notes }) => ({
        name,
        startDate,
        endDate,
        notes,
      })),
    );
    setIsSaving(false);
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm text-muted-foreground">
        Each tour ends on a day the agent settled many shops at once and starts
        the day after the previous one. Fix the dates to match the real trips,
        untick anything that was not a tour, then save.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="w-8 py-1" aria-label="Include" />
            <th className="py-1 pr-2 font-medium">Name</th>
            <th className="py-1 pr-2 font-medium">Start</th>
            <th className="py-1 pr-2 font-medium">End</th>
            <th className="py-1 text-right font-medium">Shops</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.include ? '' : 'opacity-50'}>
              <td className="py-1">
                <Checkbox
                  checked={row.include}
                  onCheckedChange={(checked) =>
                    patch(row.key, { include: checked === true })
                  }
                />
              </td>
              <td className="py-1 pr-2">
                <Input
                  value={row.name}
                  onChange={(event) =>
                    patch(row.key, { name: event.target.value })
                  }
                />
              </td>
              <td className="py-1 pr-2">
                <Input
                  type="date"
                  value={row.startDate}
                  onChange={(event) =>
                    patch(row.key, { startDate: event.target.value })
                  }
                />
              </td>
              <td className="py-1 pr-2">
                <Input
                  type="date"
                  value={row.endDate ?? ''}
                  onChange={(event) =>
                    patch(row.key, { endDate: event.target.value || null })
                  }
                />
              </td>
              <td className="py-1 text-right tabular-nums">
                {row.creditLines}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
        <Button
          onClick={handleSave}
          disabled={isSaving || selected.length === 0}
        >
          Save selected ({selected.length})
        </Button>
      </div>
    </div>
  );
};
