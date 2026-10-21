import { AlertTriangle } from 'lucide-react';
import { Switch } from '@/renderer/shad/ui/switch';
import { useAdvancedCapability } from '@/renderer/hooks/useAdvancedCapabilities';
import { ADVANCED_CAPABILITIES } from '@/core/advancedCapabilities';
import { useMountEffect } from '@/renderer/hooks/useMountEffect';
import { cn } from '@/renderer/lib/utils';
import { formatBillDate, formatSheetAmount } from '../buildCollectionSheetRows';
import {
  useCollectionSources,
  type ReviewedSource,
  type SheetRange,
} from './useCollectionSources';

interface CollectionSourcesReviewProps {
  chartId: number;
  range: SheetRange;
  onChanged: () => void;
}

interface SourceRowProps {
  source: ReviewedSource;
  saving: boolean;
  /** whether the switch that changes an account's role is available */
  canSetRole: boolean;
  onToggle: (source: ReviewedSource, wantCounts: boolean) => void;
}

const SourceRow: React.FC<SourceRowProps> = ({
  source,
  saving,
  canSetRole,
  onToggle,
}: SourceRowProps) => {
  const { verdict } = source;
  return (
    <tr
      className={cn(
        'border-b align-top last:border-0',
        verdict.flag && 'bg-amber-50 dark:bg-amber-950/30',
      )}
    >
      <td className="py-2 pr-2">
        <div className="font-medium">{source.name}</div>
        <div className="text-xs text-muted-foreground">
          {source.headName} · {verdict.reason}
        </div>
        {verdict.flag ? (
          <div className="mt-1 flex items-center gap-1 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {verdict.flag}
          </div>
        ) : null}
      </td>
      <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
        {formatSheetAmount(Math.round(source.amount))}
        <div className="text-xs text-muted-foreground">
          {source.shops} shop{source.shops === 1 ? '' : 's'}
        </div>
      </td>
      {canSetRole ? (
        <td className="py-2 text-right">
          <Switch
            checked={verdict.counts}
            disabled={saving}
            onCheckedChange={(checked) => onToggle(source, checked)}
            aria-label={`${source.name} counts as payment`}
          />
        </td>
      ) : null}
    </tr>
  );
};

/** mounted per open + range, so it loads once and reloads after each switch */
export const CollectionSourcesReview: React.FC<
  CollectionSourcesReviewProps
> = ({ chartId, range, onChanged }: CollectionSourcesReviewProps) => {
  const { sources, isLoading, savingId, load, setCounts } =
    useCollectionSources(chartId, range, onChanged);

  // the switch writes account.collectionRole, which the main process
  // refuses while the capability is off. Without this the switch would be
  // on screen and every flip would come back as an error, so the column
  // goes away instead.
  const canSetRole = useAdvancedCapability(
    ADVANCED_CAPABILITIES.accountCollectionRole,
  );

  useMountEffect(() => {
    load().catch((error) => console.error('Error loading sources:', error));
  });

  const flagged = sources.filter((source) => source.verdict.flag).length;

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-muted-foreground">
        Every account that credited this agent&apos;s shops from{' '}
        {formatBillDate(range.from)} to {formatBillDate(range.to)}.
        {canSetRole
          ? ' Switched on means it is money received: it shows in Collected and the tour columns. Usually only the highlighted rows need a decision.'
          : ' Money received shows in Collected and the tour columns. Usually only the highlighted rows need a decision.'}
      </p>
      {flagged > 0 ? (
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
          {flagged} account{flagged === 1 ? '' : 's'} to check
        </p>
      ) : null}
      {!isLoading && sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing credited these shops in this range.
        </p>
      ) : null}
      {sources.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-2 font-medium">Account</th>
              <th className="py-2 pr-2 text-right font-medium">Amount</th>
              {canSetRole ? (
                <th className="py-2 text-right font-medium">Payment</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <SourceRow
                key={source.accountId}
                source={source}
                saving={savingId === source.accountId}
                canSetRole={canSetRole}
                onToggle={(target, wantCounts) => {
                  setCounts(target, wantCounts).catch((error) =>
                    console.error('Error saving collection role:', error),
                  );
                }}
              />
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
};
