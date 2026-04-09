import { type ChangeEvent } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { Input } from './input';

interface SearchProps {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
  autoFocus?: boolean;
}

export const Search = ({
  placeholder = 'Search…',
  value,
  onChange,
  className,
  autoFocus = false,
}: SearchProps) => (
  <div className="relative min-w-0">
    <SearchIcon
      aria-hidden="true"
      className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
    />
    <Input
      type="search"
      placeholder={placeholder}
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) =>
        onChange?.(e.target.value)
      }
      aria-label={placeholder}
      autoComplete="off"
      autoFocus={autoFocus}
      spellCheck={false}
      className={`h-10 pl-9 pr-3 text-sm ${className}`}
    />
  </div>
);
