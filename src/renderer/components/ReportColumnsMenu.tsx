import { useCallback, useState } from 'react';
import { Columns3, X } from 'lucide-react';
/* eslint-disable react/prop-types */ import { Button } from '@/renderer/shad/ui/button';
import { Input } from '@/renderer/shad/ui/input';
import { cn } from '@/renderer/lib/utils';

export interface ReportColumnOption {
  id: string;
  label: string;
}

interface ReportColumnsMenuProps {
  columns: readonly ReportColumnOption[];
  included: ReadonlySet<string>;
  onToggle: (id: string, next: boolean) => void;
  onToggleAll: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}

export const ReportColumnsMenu: React.FC<ReportColumnsMenuProps> = ({
  columns,
  included,
  onToggle,
  onToggleAll,
  disabled = false,
  className,
  label = 'Columns',
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = columns.filter((column) =>
    column.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const allIncluded = columns.length > 0 && included.size === columns.length;

  const handleToggleAll = useCallback(() => {
    onToggleAll(!allIncluded);
  }, [allIncluded, onToggleAll]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={disabled}
        className={cn('relative', className)}
        onClick={() => setOpen(true)}
        title={label}
        aria-label={`${label} (${included.size} of ${columns.length} visible)`}
      >
        <Columns3 className="h-4 w-4" />
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
          {included.size}
        </span>
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40"
            role="button"
            tabIndex={0}
            aria-label="Close column picker"
            onClick={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-background p-4 shadow-xl sm:left-auto sm:right-0 sm:top-0 sm:h-full sm:w-96 sm:rounded-none">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{label}</h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a column…"
              className="mb-3"
            />

            <div className="mb-2 flex items-center justify-between border-b pb-2">
              <button
                type="button"
                className="text-sm font-medium text-primary"
                onClick={handleToggleAll}
              >
                {allIncluded ? 'Hide all' : 'Show all'}
              </button>
              <span className="text-xs text-muted-foreground">
                {included.size} of {columns.length} shown
              </span>
            </div>

            <ul className="max-h-[50vh] overflow-y-auto">
              {filtered.length === 0 ? (
                <li className="py-6 text-center text-sm text-muted-foreground">
                  No columns match.
                </li>
              ) : (
                filtered.map((column) => {
                  const inputId = `column-${column.id}`;
                  return (
                    <li key={column.id}>
                      <label
                        htmlFor={inputId}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"
                      >
                        <input
                          id={inputId}
                          type="checkbox"
                          className="h-4 w-4"
                          checked={included.has(column.id)}
                          onChange={(e) =>
                            onToggle(column.id, e.target.checked)
                          }
                        />
                        <span className="text-sm">{column.label}</span>
                      </label>
                    </li>
                  );
                })
              )}
            </ul>

            <div className="mt-3 flex justify-end">
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

ReportColumnsMenu.displayName = 'ReportColumnsMenu';

export default ReportColumnsMenu;
