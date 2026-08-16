import { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, Check, Copy, Search } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Input } from '@/renderer/shad/ui/input';
import { Label } from '@/renderer/shad/ui/label';
import type { AttributeDefinition, InventoryItem } from 'types';
import {
  applyCopyPlan,
  buildCopyPlan,
  countChanges,
  defaultSelection,
  discriminatingKeys,
  groupCandidates,
  headerCheckedValue,
  matchesSearch,
  rankCandidates,
  selectionState,
  summaryOf,
  toggleAll,
  type CopyRow,
} from './copyAttributes';

interface CopyAttributesPanelProps {
  item: InventoryItem;
  definitions: AttributeDefinition[];
  values: Record<string, string>;
  /**
   * Every item that could be a source. The caller fetches before rendering this
   * panel, so there is no loading state here: the whole load is a couple of
   * milliseconds, and a skeleton that appears for 20ms is itself a flash.
   */
  candidates: InventoryItem[];
  /** hands back the prefilled values and the source's name; caller still saves */
  onPrefill: (next: Record<string, string>, sourceName: string) => void;
  onClose: () => void;
}

/** how many candidates to render before asking the user to narrow the search */
const VISIBLE_CANDIDATES = 20;

const ACTION_LABEL: Record<CopyRow['action'], string> = {
  fill: 'Fill',
  overwrite: 'Replace',
  same: 'Same',
};

/** One selectable source item: its code plus what sets it apart from the rest. */
const CandidateRow: React.FC<{
  candidate: InventoryItem;
  summaryKeys: readonly string[];
  onChoose: (item: InventoryItem) => void;
}> = ({
  candidate,
  summaryKeys,
  onChoose,
}: {
  candidate: InventoryItem;
  summaryKeys: readonly string[];
  onChoose: (item: InventoryItem) => void;
}) => (
  <li>
    <button
      type="button"
      onClick={() => onChoose(candidate)}
      className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left hover:bg-accent"
    >
      <span className="text-sm font-medium">{candidate.name}</span>
      <span className="line-clamp-1 text-xs text-muted-foreground">
        {summaryOf(candidate, summaryKeys) || 'No described attributes'}
      </span>
    </button>
  </li>
);

/**
 * Copy attributes from another item into the editor's fields.
 *
 * Replaces the editor's body rather than sitting above it: picking a source and
 * editing fields are separate tasks, and stacking them made the dialog taller
 * than the screen. One task is on show at a time, with a back button.
 *
 * Nothing is written here. `onPrefill` populates the form and the user saves.
 */
export const CopyAttributesPanel: React.FC<CopyAttributesPanelProps> = ({
  item,
  definitions,
  values,
  candidates,
  onPrefill,
  onClose,
}: CopyAttributesPanelProps) => {
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<InventoryItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ranked here rather than by the caller: ordering depends on which item is
  // being edited, and the caller only knows the raw list
  const ranked = useMemo(
    () => rankCandidates(candidates, item),
    [candidates, item],
  );

  // summary keys are computed per group, not over the whole catalogue: what
  // tells one family's members apart is not what tells the catalogue apart
  const groups = useMemo(() => {
    const matching = ranked.filter((c) => matchesSearch(c, search));
    const { family, others } = groupCandidates(matching, item);
    return {
      family,
      others,
      total: matching.length,
      familyKeys: discriminatingKeys(family, definitions),
      otherKeys: discriminatingKeys(others, definitions),
    };
  }, [ranked, search, item, definitions]);

  const rows = useMemo(
    () => (source ? buildCopyPlan(definitions, values, source) : []),
    [source, definitions, values],
  );

  const chooseSource = useCallback(
    (next: InventoryItem) => {
      setSource(next);
      setSelected(defaultSelection(buildCopyPlan(definitions, values, next)));
    },
    [definitions, values],
  );

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const changeCount = countChanges(rows, selected);
  const replacing = rows.filter(
    (r) => r.action === 'overwrite' && selected.has(r.key),
  ).length;
  const headerState = selectionState(rows, selected);

  // ---- step 1: choose a source -------------------------------------------
  if (!source) {
    return (
      <div className="flex min-h-0 flex-col gap-3">
        {ranked.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No other item has attributes to copy yet. Fill one in by hand first,
            then it can be the source for the rest of its family.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="copy-search" className="text-xs">
                Search by item code
              </Label>
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="copy-search"
                  className="pl-7"
                  placeholder="Search items"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
              {groups.total === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No item matches “{search}”.
                </p>
              ) : (
                <>
                  {groups.family.length > 0 && (
                    <>
                      <p className="sticky top-0 bg-muted/95 px-2 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
                        Same family
                      </p>
                      <ul className="p-1">
                        {groups.family
                          .slice(0, VISIBLE_CANDIDATES)
                          .map((candidate) => (
                            <CandidateRow
                              key={candidate.id}
                              candidate={candidate}
                              summaryKeys={groups.familyKeys}
                              onChoose={chooseSource}
                            />
                          ))}
                      </ul>
                    </>
                  )}
                  {groups.others.length > 0 && (
                    <>
                      <p className="sticky top-0 bg-muted/95 px-2 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
                        Other items
                      </p>
                      <ul className="p-1">
                        {groups.others
                          .slice(0, VISIBLE_CANDIDATES)
                          .map((candidate) => (
                            <CandidateRow
                              key={candidate.id}
                              candidate={candidate}
                              summaryKeys={groups.otherKeys}
                              onChoose={chooseSource}
                            />
                          ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>

            {groups.total > VISIBLE_CANDIDATES ? (
              <p className="text-xs text-muted-foreground">
                {groups.total} items match — type a code to narrow the list.
              </p>
            ) : null}

            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ---- step 2: agree to the changes --------------------------------------
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        From <strong>{source.name}</strong>. Ticked rows are copied into the
        form — nothing is saved until you press <strong>Save attributes</strong>
        .
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/95 text-left text-xs font-medium text-muted-foreground backdrop-blur">
            <tr>
              <th className="w-10 px-2 py-1.5">
                <Checkbox
                  checked={headerCheckedValue(rows, selected)}
                  onCheckedChange={() =>
                    setSelected((prev) => toggleAll(rows, prev))
                  }
                  aria-label={
                    headerState === 'all' ? 'Clear all' : 'Select all changes'
                  }
                />
              </th>
              <th className="px-2 py-1.5 font-medium">Attribute</th>
              <th className="px-2 py-1.5 font-medium">Now</th>
              <th className="px-2 py-1.5 font-medium">Becomes</th>
              <th className="px-2 py-1.5 font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t">
                <td className="px-2 py-1.5">
                  <Checkbox
                    checked={selected.has(row.key)}
                    disabled={row.action === 'same'}
                    onCheckedChange={() => toggle(row.key)}
                    aria-label={`Copy ${row.label} from ${source.name}`}
                  />
                </td>
                <td className="px-2 py-1.5 font-medium">{row.label}</td>
                <td className="px-2 py-1.5 text-muted-foreground">
                  {row.current || <span aria-label="empty">—</span>}
                </td>
                <td className="px-2 py-1.5">{row.incoming}</td>
                <td className="px-2 py-1.5 text-xs">
                  {/* labelled as well as coloured: filling a blank versus
                      replacing a value must survive being read without colour */}
                  <span
                    className={
                      row.action === 'overwrite'
                        ? 'font-medium text-destructive'
                        : 'text-muted-foreground'
                    }
                  >
                    {ACTION_LABEL[row.action]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {replacing > 0 ? (
        <p className="text-xs text-destructive">
          {replacing} existing value{replacing === 1 ? '' : 's'} would be
          replaced. Those are usually what makes this item different — untick
          any you want to keep.
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            onPrefill(applyCopyPlan(values, rows, selected), source.name);
            onClose();
          }}
          disabled={changeCount === 0}
          className="gap-2"
        >
          <Check size={16} />
          Copy {changeCount} value{changeCount === 1 ? '' : 's'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => setSource(null)}
          className="gap-2"
        >
          <ArrowLeft size={14} />
          Different item
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

/**
 * The trigger the editor renders; kept here so icon and wording live together.
 *
 * `loading` covers the fetch the click kicks off. It is normally imperceptible,
 * but the button reports it rather than looking dead if the catalogue is large.
 */
export const CopyAttributesTrigger: React.FC<{
  onClick: () => void;
  loading?: boolean;
}> = ({ onClick, loading }: { onClick: () => void; loading?: boolean }) => (
  <Button
    variant="outline"
    size="sm"
    onClick={onClick}
    disabled={loading}
    className="gap-2"
  >
    <Copy size={14} />
    {loading ? 'Loading…' : 'Copy from…'}
  </Button>
);

export default CopyAttributesPanel;
