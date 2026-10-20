/**
 * Device-local advanced-capability storage for the Electron main process.
 *
 * The registry and the parsing rules live in src/core/advancedCapabilities.ts
 * (platform-free, shared with the renderer and the web worker). This file
 * is the desktop half: it reads and writes the enabled set in
 * electron-store, which is the same store the renderer's synchronous
 * `window.electron.store` bridge exposes.
 *
 * Two consumers, one source of truth:
 *  - the `advanced:getCapabilities` / `advanced:setCapabilities` IPC
 *    handlers, which the renderer's `useAdvancedCapabilities` hook calls;
 *  - the destructive-action guard (see src/main/main.ts), which refuses
 *    the dangerous calls when the flag is off.
 *
 * The second consumer is the reason this reads the store directly rather
 * than going through IPC: a guard that asked the renderer whether an
 * action was allowed would be asking the thing it is meant to constrain.
 */
import { store } from '../store';
import {
  ADVANCED_CAPABILITIES_STORE_KEY,
  parseAdvancedCapabilities,
  serializeAdvancedCapabilities,
  type AdvancedCapability,
} from '../../core/advancedCapabilities';

/**
 * The advanced capabilities enabled on this device.
 *
 * `store.get` returns the value electron-store deserialized from disk, so
 * this is normally an array of ids; `parseAdvancedCapabilities` also
 * tolerates a JSON string and a bare id, so a hand-edited store file
 * cannot crash the app.
 */
export const getEnabledAdvancedCapabilities = (): Set<AdvancedCapability> =>
  parseAdvancedCapabilities(store.get(ADVANCED_CAPABILITIES_STORE_KEY));

/**
 * Replaces the enabled set. Unknown ids are dropped, and the stored value
 * is normalized (the `all` sentinel expanded, order made stable) so the
 * same logical set always serializes to the same bytes on disk.
 */
export const setEnabledAdvancedCapabilities = (
  capabilities: readonly AdvancedCapability[],
): void => {
  const normalized = serializeAdvancedCapabilities(capabilities);
  store.set(ADVANCED_CAPABILITIES_STORE_KEY, normalized);
};

/**
 * Whether `capability` is enabled on this device.
 *
 * The guard for the destructive actions reads this directly. Note what it
 * does and does not promise: it stops a *renderer* that has not been told
 * about the flag from performing the action, but it is not a security
 * boundary against someone editing electron-store by hand — see
 * src/core/advancedCapabilities.ts's doc comment.
 */
export const isAdvancedCapabilityEnabled = (
  capability: AdvancedCapability,
): boolean => getEnabledAdvancedCapabilities().has(capability);

/**
 * Throws unless `capability` is enabled on this device.
 *
 * Used to guard the destructive IPC handlers, so a renderer that calls
 * `window.electron.reverseJournal(...)` directly — bypassing the hidden
 * buttons — is refused rather than obeyed.
 *
 * The message is deliberately specific about *how* to enable the action
 * rather than merely failing: the person who hit this is at the Settings
 * screen, and "Advanced controls are turned off" tells them where to go.
 */
export const requireAdvancedCapability = (
  capability: AdvancedCapability,
): void => {
  if (isAdvancedCapabilityEnabled(capability)) return;
  throw new Error(
    `"${capability}" is an advanced action and is turned off on this ` +
      'device. Turn on advanced controls in Settings to use it.',
  );
};
