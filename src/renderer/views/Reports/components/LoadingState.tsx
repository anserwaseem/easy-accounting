import { Skeleton } from '@/renderer/shad/ui/skeleton';

interface LoadingStateProps {
  variant?: 'skeleton' | 'text';
  message?: string;
  skeletonCount?: number;
}

export const LoadingState = ({
  variant = 'text',
  message = 'Loading data...',
  skeletonCount = 5,
}: LoadingStateProps) => {
  if (variant === 'skeleton') {
    return (
      <div className="space-y-2 print-loading-state">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <Skeleton key={`skeleton-${i}`} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center h-64 print-loading-state">
      <p className="text-muted-foreground animate-pulse">{message}</p>
    </div>
  );
};
