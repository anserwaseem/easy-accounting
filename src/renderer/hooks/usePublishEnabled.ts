import { useEffect, useState } from 'react';
import { missingPublishConfig } from './usePublishSettings';

/**
 * Whether this installation publishes a catalog at all.
 *
 * Publishing is optional: an installation that only does accounting has no
 * bucket, no price list and no storefront. Controls that only make sense when
 * publishing — holding an item back, marking an attribute public, per-item
 * publish state — are noise there, and worse, they imply a feature that will
 * never do anything. So they are hidden until the configuration exists rather
 * than shown in a dead state.
 *
 * Returns `null` while loading, so callers can render nothing rather than
 * flashing a control that is about to disappear.
 */
export const usePublishEnabled = (): boolean | null => {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electron
      .getPublishConfig()
      .then((config) => {
        if (!cancelled) setEnabled(missingPublishConfig(config).length === 0);
        return config;
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return enabled;
};

export default usePublishEnabled;
