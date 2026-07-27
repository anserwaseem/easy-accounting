import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

export interface ItemPublishStatus {
  id: number;
  state: 'ready' | 'held back' | 'not ready';
  blockers: string[];
}

/**
 * Per-item publish state, keyed by inventory id.
 *
 * The Settings panel reports that (say) seven items are not ready; it cannot
 * say *which* seven, which leaves the user comparing counts against a table by
 * hand. This fetches the same decision per item so the answer is on the row.
 *
 * Loaded on demand rather than with the inventory: it reads the images manifest
 * over the network, and most visits to this page are not about publishing.
 */
export interface PublishStatusMap {
  byId: Record<number, ItemPublishStatus>;
  /**
   * False until the first fetch returns. Without it "no status yet" and "this
   * item is not a catalog candidate" both render as a bare dash, and most rows
   * are the latter — 649 of 995 here — so the table looks broken rather than
   * informative.
   */
  loaded: boolean;
}

export const usePublishStatuses = (
  enabled: boolean,
): {
  statuses: PublishStatusMap;
  /** re-read after anything that could change publishability */
  refresh: () => void;
} => {
  const [statuses, setStatuses] = useState<PublishStatusMap>({
    byId: {},
    loaded: false,
  });

  const load = useCallback(async () => {
    try {
      const report = await window.electron.getItemPublishStatuses();
      setStatuses({
        byId: Object.fromEntries(
          (report.statuses as ItemPublishStatus[]).map((row) => [row.id, row]),
        ),
        loaded: true,
      });
    } catch {
      setStatuses({ byId: {}, loaded: true });
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  const refresh = useCallback(() => {
    if (enabled) load();
  }, [enabled, load]);

  return { statuses, refresh };
};

/**
 * Statuses reach the badge through context, not through the column definition.
 *
 * Column definitions are memoised; making them depend on the status map meant a
 * status refresh produced new column objects, TanStack remounted every cell,
 * and any dialog open inside a cell — the item editor — was destroyed
 * mid-interaction. Cells subscribe here instead, so refreshing statuses
 * re-renders the badges and nothing else.
 */
const StatusContext = createContext<PublishStatusMap>({
  byId: {},
  loaded: false,
});

export const PublishStatusProvider = StatusContext.Provider;

const TONE: Record<ItemPublishStatus['state'], string> = {
  ready:
    'bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-50',
  'held back':
    'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-50',
  'not ready': 'bg-muted text-muted-foreground',
};

/**
 * One item's publish state.
 *
 * "Ready" rather than "Published": this app knows what *would* be published,
 * not what a storefront has actually taken — that lives downstream, and
 * claiming otherwise would be a comfortable lie.
 *
 * The reason is written next to the state, not encoded in the colour, so it
 * survives being read without colour perception and needs no legend.
 */
export const PublishStatusBadge: React.FC<{ itemId: number }> = ({
  itemId,
}: {
  itemId: number;
}) => {
  const { byId, loaded } = useContext(StatusContext);
  const status = byId[itemId];

  // three different nothings, told apart: still fetching, never a candidate,
  // or a real state. Collapsing them into one dash is what made this column
  // look broken.
  if (!loaded) {
    return <span className="text-xs text-muted-foreground">checking…</span>;
  }
  if (!status) {
    return (
      <span
        className="text-xs text-muted-foreground"
        title="Not a catalog item — it has no attributes and no price list entry"
      >
        not in catalog
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-0.5">
      <span
        className={`w-fit rounded px-1.5 py-0.5 text-xs font-medium ${
          TONE[status.state]
        }`}
      >
        {status.state === 'ready' ? 'Ready' : status.state}
      </span>
      {status.blockers.length > 0 ? (
        <span className="text-xs text-muted-foreground">
          {status.blockers.join(', ')}
        </span>
      ) : null}
    </span>
  );
};

export default PublishStatusBadge;
