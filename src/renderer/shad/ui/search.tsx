import { type ChangeEvent } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { Input } from './input';

interface SearchProps {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
}

export const Search = ({
  placeholder = 'Search...',
  value,
  onChange,
  className,
}: SearchProps) => (
  <div className="relative">
    <SearchIcon className="absolute left-2 top-[18px] h-4 w-4 text-muted-foreground transition-colors duration-200 group-focus-within:text-primary" />
    <Input
      type="search"
      placeholder={placeholder}
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) =>
        onChange?.(e.target.value)
      }
      className={`pl-8 pr-4 h-9 transition-all duration-200 focus:ring-2 focus:ring-ring focus:ring-offset-2 ${className}`}
    />
  </div>
);
