interface JournalNarrationTextProps {
  narration?: string;
  reversesJournalUuid?: string | null;
  hasReversal?: boolean;
}

/** marks a reversal and a journal that already has one, so the list is not two identical rows */
export const JournalNarrationText: React.FC<JournalNarrationTextProps> = ({
  narration,
  reversesJournalUuid,
  hasReversal,
}: JournalNarrationTextProps) => {
  return (
    <span>
      {reversesJournalUuid ? (
        <span className="text-muted-foreground">Reversal · </span>
      ) : null}
      {hasReversal ? (
        <span className="text-muted-foreground">Reversed · </span>
      ) : null}
      <span className="text-foreground">{narration}</span>
    </span>
  );
};
