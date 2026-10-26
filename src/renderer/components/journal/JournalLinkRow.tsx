import { useNavigate } from 'react-router-dom';
import { Button } from '@/renderer/shad/ui/button';

interface JournalLinkRowProps {
  label: string;
  journalId: number;
  narration?: string;
}

export const JournalLinkRow: React.FC<JournalLinkRowProps> = ({
  label,
  journalId,
  narration,
}: JournalLinkRowProps) => {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-0.5 items-start sm:flex-row sm:gap-8 sm:items-center">
      <p className="font-medium text-sm text-muted-foreground w-full sm:w-[160px] sm:shrink-0">
        {label}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => navigate(`/journals/${journalId}`)}
      >
        {narration || 'Open journal'}
      </Button>
    </div>
  );
};
