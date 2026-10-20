import {
  type PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ALL_ADVANCED_CAPABILITIES,
  type AdvancedCapability,
} from '@/core/advancedCapabilities';

/**
 * Advanced capabilities — the destructive or rare actions an ordinary user
 * should not be shown: reversing a journal, deleting one, returning a
 * posted invoice, deleting an account, adjusting stock.
 *
 * See src/core/advancedCapabilities.ts for why this is a device-local flag
 * and not a per-user role (the short version: the app has no role system,
 * and the data model is only partly user-scoped, so a per-user role would
 * mean retrofitting user-scoping across most of the schema first).
 *
 * A provider rather than a per-component fetch, because the enabled set
 * is read once and then shared by every gate: a dozen components each
 * polling the store would be a dozen IPC round-trips to answer the same
 * question, and they could disagree while the answers were in flight.
 *
 * The set is read once on mount and changes only when {@link setEnabled}
 * is called, so there is no polling and no subscription to maintain. A
 * second device (or a second browser profile) has its own set, which is
 * the point: unlocking the shop's own machine does not unlock the
 * counter's tablet.
 */

interface AdvancedCapabilitiesContextState {
  /** The enabled capability ids. Empty until the first read resolves. */
  enabled: ReadonlySet<AdvancedCapability>;
  /** Replaces the enabled set. */
  setEnabled: (capabilities: AdvancedCapability[]) => Promise<void>;
  /** True once the first read has resolved. */
  loaded: boolean;
}

const AdvancedCapabilitiesContext = createContext<
  AdvancedCapabilitiesContextState | undefined
>(undefined);

/**
 * The state used when there is no provider above the component.
 *
 * Failing closed is deliberate: a component rendered outside the provider
 * shows no advanced control at all, which is the same thing a user sees
 * on a device where nothing is enabled. The alternative — throwing, the
 * way a required context usually does — would mean every page component
 * that happens to contain an <AdvancedControl> could only be rendered in
 * a test with the provider wrapped around it, which is a lot of ceremony
 * for a gate whose safe answer is "hidden".
 *
 * `setEnabled` is the exception: turning a control on genuinely needs the
 * provider, so that one still raises.
 */
const FALLBACK_STATE: AdvancedCapabilitiesContextState = {
  enabled: new Set<AdvancedCapability>(),
  loaded: true,
  setEnabled: async () => {
    throw new Error(
      'Advanced controls cannot be changed here: no AdvancedCapabilitiesProvider is mounted',
    );
  },
};

export const AdvancedCapabilitiesProvider: React.FC<PropsWithChildren> = ({
  children,
}: PropsWithChildren) => {
  const [enabled, setEnabledState] = useState<ReadonlySet<AdvancedCapability>>(
    new Set(),
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    window.electron
      .getAdvancedCapabilities()
      .then((capabilities) => {
        if (cancelled) return;
        setEnabledState(new Set(capabilities ?? []));
        setLoaded(true);
      })
      .catch(() => {
        // A failed read means "nothing is enabled" — the safe direction.
        // The controls stay hidden rather than appearing unlocked.
        if (cancelled) return;
        setEnabledState(new Set());
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setEnabled = useCallback(async (capabilities: AdvancedCapability[]) => {
    await window.electron.setAdvancedCapabilities(capabilities);
    setEnabledState(new Set(capabilities));
  }, []);

  const value = useMemo(
    () => ({ enabled, setEnabled, loaded }),
    [enabled, setEnabled, loaded],
  );

  return (
    <AdvancedCapabilitiesContext.Provider value={value}>
      {children}
    </AdvancedCapabilitiesContext.Provider>
  );
};

export const useAdvancedCapabilities = (): AdvancedCapabilitiesContextState => {
  const context = useContext(AdvancedCapabilitiesContext);

  return context ?? FALLBACK_STATE;
};

/**
 * Whether one advanced capability is enabled.
 *
 * Returns `false` until the first read resolves, so a control gated on
 * this renders hidden rather than flashing into view.
 */
export const useAdvancedCapability = (
  capability: AdvancedCapability,
): boolean => {
  const { enabled, loaded } = useAdvancedCapabilities();
  return loaded && enabled.has(capability);
};

/** Every advanced capability id, for the "turn everything on" case. */
export const allAdvancedCapabilities = (): AdvancedCapability[] => [
  ...ALL_ADVANCED_CAPABILITIES,
];

export default useAdvancedCapabilities;
