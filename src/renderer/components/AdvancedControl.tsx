import type { FC, ReactNode } from 'react';
import type { AdvancedCapability } from '@/core/advancedCapabilities';
import { useAdvancedCapability } from '../hooks/useAdvancedCapabilities';

export interface AdvancedControlProps {
  /** The capability this control requires. */
  capability: AdvancedCapability;
  children: ReactNode;
}

/**
 * Renders its children only when the given advanced capability is enabled
 * on this device.
 *
 * The single place advanced controls are gated in the UI. Wrapping a
 * control here is what "hiding it from ordinary users" means in this
 * codebase — the alternative, a `canDelete` boolean threaded down from
 * each page, scatters the rule across every call site and makes it easy
 * to forget one.
 *
 * Two things this is worth knowing:
 *
 *  - It hides the control; it does not make the action impossible. The
 *    main process (desktop) and the db worker (web) separately refuse the
 *    destructive calls when the capability is off, so a renderer that
 *    calls the API directly is turned away rather than obeyed. Those two
 *    layers read the same enabled set.
 *
 *  - It renders nothing at all until the enabled set has loaded. That
 *    costs one IPC round-trip at startup and buys the absence of a
 *    control that appears and then vanishes, which reads as a glitch.
 */
export const AdvancedControl: FC<AdvancedControlProps> = ({
  capability,
  children,
}) => {
  const enabled = useAdvancedCapability(capability);

  if (!enabled) return null;

  // the fragment is load-bearing: callers wrap a single control, and
  // returning it bare would type the return as ReactNode rather than
  // JSX.Element
  // eslint-disable-next-line react/jsx-no-useless-fragment
  return <>{children}</>;
};

export default AdvancedControl;
