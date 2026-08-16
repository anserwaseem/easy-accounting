import { useEffect, useState } from 'react';
import { usePublishEnabled } from './usePublishEnabled';

/** Persisted with the table's other column choices. */
export const SHOW_PUBLISH_COLUMN_KEY = 'inventoryShowPublishColumn';

/**
 * Whether this user is currently doing publishing work.
 *
 * Two conditions, and both matter. `usePublishEnabled` answers "can this
 * installation publish at all", which is about configuration. This adds "has
 * the user asked to see publishing", which is about attention: someone entering
 * stock and prices should not be reading fields that only affect a storefront.
 *
 * So publish-only controls follow the Publish column. Turning that column on is
 * how a user says they are thinking about the shop, and it is already where the
 * per-item publish state and the "keep out of the catalog" checkbox appear.
 * Hanging the display title off the same switch means there is one thing to
 * learn rather than three.
 *
 * Read once per mount rather than subscribed: the dialogs that use this are
 * opened after the choice is made, and a control appearing underneath an open
 * form would be worse than a stale one.
 */
export const usePublishColumnVisible = (): boolean => {
  const enabled = usePublishEnabled() === true;
  const [shown, setShown] = useState(false);

  useEffect(() => {
    setShown(Boolean(window.electron.store.get(SHOW_PUBLISH_COLUMN_KEY)));
  }, []);

  return enabled && shown;
};

export default usePublishColumnVisible;
