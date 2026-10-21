import type { FC, ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import type { AdvancedCapability } from '@/core/advancedCapabilities';
import { useAdvancedCapabilities } from '../hooks/useAdvancedCapabilities';

export interface AdvancedRouteProps {
  /** The capability this page requires. */
  capability: AdvancedCapability;
  children: ReactElement;
  /** Where to send the user when the capability is off. */
  fallback?: string;
}

/**
 * Renders its children only when the given advanced capability is enabled
 * on this device, and otherwise redirects.
 *
 * The page-level counterpart to {@link AdvancedControl}. That one hides a
 * control inside a page; this one hides a whole page, for a module the
 * owner does not want the people using the machine to know exists at all.
 * Hiding the entry points (a report card, a menu item) is not enough on
 * its own, because a URL is typeable and a link can be bookmarked.
 *
 * The redirect waits for the enabled set to load first. Bouncing to the
 * fallback before the read resolves would send an owner who *does* have the
 * capability away from the page every time they opened it.
 */
export const AdvancedRoute: FC<AdvancedRouteProps> = ({
  capability,
  children,
  fallback = '/reports',
}) => {
  const { enabled, loaded } = useAdvancedCapabilities();

  // still reading the store: render nothing rather than guess
  if (!loaded) return null;

  if (!enabled.has(capability)) return <Navigate to={fallback} replace />;

  return children;
};

export default AdvancedRoute;
