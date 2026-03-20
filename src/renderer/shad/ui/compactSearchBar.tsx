import { Search } from 'lucide-react';
import { trim } from 'lodash';
import { Input } from './input';

interface CompactSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  filteredCount: number;
  totalCount: number;
  className?: string;
  inputClassName?: string;
}

export const CompactSearchBar: React.FC<CompactSearchBarProps> = ({
  value,
  onChange,
  placeholder = 'Search…',
  ariaLabel = 'Search',
  filteredCount,
  totalCount,
  className,
  inputClassName,
}: CompactSearchBarProps) => {
  const hasSearchTerm = Boolean(trim(value));
  const countLabel = hasSearchTerm
    ? `${filteredCount} / ${totalCount}`
    : `${totalCount} total`;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border bg-background px-2 py-2 ${
        className || ''
      }`}
    >
      <div className="relative min-w-0 flex-1">
        <Search
          size={16}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          name="compact-search"
          autoComplete="off"
          spellCheck={false}
          className={`h-9 border-0 bg-transparent pl-8 pr-2 shadow-none focus-visible:ring-0 ${
            inputClassName || ''
          }`}
        />
      </div>
      <p className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
        {countLabel}
      </p>
    </div>
  );
};
