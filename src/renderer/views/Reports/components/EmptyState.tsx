interface EmptyStateProps {
  message?: string;
}

export const EmptyState = ({
  message = 'No data available.',
}: EmptyStateProps) => {
  return (
    <div className="flex justify-center items-center h-64">
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
};
