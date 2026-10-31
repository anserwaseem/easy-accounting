import type { FC } from 'react';

/**
 * Clean, lightweight skeleton fallback rendered while a lazy-loaded route chunk is loading.
 * Kept inside Sidebar so the frame, sidebar, topbar, and search remain active and visible.
 */
export const RouteLoadingFallback: FC = () => {
  return (
    <div className="w-full space-y-6 py-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-48 rounded bg-muted/60" />
        <div className="flex gap-2">
          <div className="h-8 w-24 rounded bg-muted/40" />
          <div className="h-8 w-8 rounded bg-muted/40" />
        </div>
      </div>
      <div className="space-y-3 pt-4">
        <div className="h-10 w-full rounded bg-muted/50" />
        <div className="h-12 w-full rounded bg-muted/30" />
        <div className="h-12 w-full rounded bg-muted/30" />
        <div className="h-12 w-full rounded bg-muted/30" />
        <div className="h-12 w-full rounded bg-muted/30" />
        <div className="h-12 w-full rounded bg-muted/30" />
      </div>
    </div>
  );
};

export default RouteLoadingFallback;
