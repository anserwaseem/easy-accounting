import { useMemo, useState } from 'react';
import { Input } from '@/renderer/shad/ui/input';
import { cn } from '@/renderer/lib/utils';

interface FamilyHeadOption {
  id: number;
  name: string;
}

interface FamilyHeadPickerProps {
  options: FamilyHeadOption[];
  value: number | null;
  onChange: (nextId: number | null) => void;
}

/**
 * inline searchable list — no Popover/Portal.
 * VirtualSelect inside Dialog stays mouse-dead (radix layer clash); this does not.
 */
export const FamilyHeadPicker: React.FC<FamilyHeadPickerProps> = ({
  options,
  value,
  onChange,
}: FamilyHeadPickerProps) => {
  const selected = options.find((o) => o.id === (value ?? 0));
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 80);
    return options.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 80);
  }, [options, query]);

  return (
    <div className="space-y-2">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Type to find head…"
        autoComplete="off"
      />
      <p className="text-xs text-muted-foreground">
        Current:{' '}
        <span className="font-medium text-foreground">
          {selected?.name ?? 'None — this is a head'}
        </span>
      </p>
      <ul className="max-h-40 overflow-y-auto rounded-md border">
        {filtered.map((opt) => {
          const active = (value ?? 0) === opt.id;
          return (
            <li key={opt.id}>
              <button
                type="button"
                className={cn(
                  'w-full px-3 py-1.5 text-left text-sm hover:bg-accent',
                  active && 'bg-accent font-medium',
                )}
                onClick={() => onChange(opt.id === 0 ? null : opt.id)}
              >
                {opt.name}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">No match</li>
        ) : null}
      </ul>
    </div>
  );
};
