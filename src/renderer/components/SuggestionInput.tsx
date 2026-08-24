import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Input } from '@/renderer/shad/ui/input';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/renderer/shad/ui/popover';
import { cn, getSearchTerms, matchesSearchTerms } from '@/renderer/lib/utils';

const MAX_VISIBLE_SUGGESTIONS = 50;

type SuggestionInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** values already in use, offered as a pick-list; typing anything else is allowed */
  suggestions: string[];
  id?: string;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  disabled?: boolean;
  className?: string;
};

/**
 * A text field that suggests the values already in use without limiting the user to them.
 *
 * Free-typed fields drift — 'Hard Binding', 'hard binding' and 'Hardbinding' become three
 * things that mean one — so the existing values are one click away, while anything typed is
 * still accepted and becomes a suggestion for the next item.
 */
export const SuggestionInput: React.FC<SuggestionInputProps> = ({
  value,
  onChange,
  suggestions,
  id,
  placeholder,
  inputMode,
  disabled = false,
  className,
}: SuggestionInputProps) => {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // typing filters the list word by word, so "hard zip" finds "Hard Binding + Zip"
  const matches = useMemo(() => {
    const terms = getSearchTerms(value);
    return suggestions
      .filter((suggestion) => matchesSearchTerms([suggestion], terms))
      .slice(0, MAX_VISIBLE_SUGGESTIONS);
  }, [suggestions, value]);

  const isNewValue =
    value.trim() !== '' &&
    !suggestions.some(
      (suggestion) => suggestion.toLowerCase() === value.trim().toLowerCase(),
    );

  useEffect(() => setHighlightedIndex(0), [value, open]);

  useEffect(() => {
    if (!open) return undefined;
    // radix's dialog and our popover ship separate dismissable-layer copies, so each treats
    // itself as the topmost layer: without this, Escape closes the surrounding dialog (losing
    // unsaved edits) as well as the list. A capture listener on window runs before both of
    // their document-level ones, so the first Escape closes the list and nothing else.
    const closeListOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener('keydown', closeListOnEscape, true);
    return () => window.removeEventListener('keydown', closeListOnEscape, true);
  }, [open]);

  const commit = useCallback(
    (next: string) => {
      onChange(next);
      setOpen(false);
      inputRef.current?.focus();
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        setHighlightedIndex((prev) => {
          const next = event.key === 'ArrowDown' ? prev + 1 : prev - 1;
          if (next < 0) return matches.length - 1;
          if (next > matches.length - 1) return 0;
          return next;
        });
        return;
      }
      if (event.key === 'Enter' && open && matches[highlightedIndex]) {
        // Enter picks the highlighted suggestion; with the list closed it stays
        // a plain text field so a new value needs no extra keystroke
        event.preventDefault();
        commit(matches[highlightedIndex]);
      }
    },
    [commit, highlightedIndex, matches, open],
  );

  const hasSuggestions = suggestions.length > 0;

  return (
    <Popover open={open && hasSuggestions} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="relative">
          <Input
            ref={inputRef}
            id={id}
            value={value}
            placeholder={placeholder}
            inputMode={inputMode}
            disabled={disabled}
            autoComplete="off"
            className={cn('my-0', hasSuggestions && 'pr-9', className)}
            onChange={(event) => {
              onChange(event.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
          />
          {hasSuggestions && (
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              aria-label={open ? 'Hide suggestions' : 'Show suggestions'}
              title={`${suggestions.length} value${
                suggestions.length === 1 ? '' : 's'
              } already in use`}
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              // keeping focus in the field means the toggle below is not undone by the
              // input's own onFocus reopening the list
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setOpen((prev) => !prev);
                inputRef.current?.focus();
              }}
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform',
                  open && 'rotate-180',
                )}
              />
            </button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
        // the field keeps focus so the list narrows as the user keeps typing
        onOpenAutoFocus={(event) => event.preventDefault()}
        // clicks on the input itself would otherwise close and immediately reopen
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) {
            event.preventDefault();
          }
        }}
      >
        <div className="max-h-60 overflow-y-auto py-1">
          {matches.map((suggestion, index) => (
            <button
              type="button"
              key={suggestion}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                index === highlightedIndex &&
                  'bg-accent text-accent-foreground',
              )}
              onMouseEnter={() => setHighlightedIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(suggestion)}
            >
              <Check
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  suggestion === value ? 'opacity-100' : 'opacity-0',
                )}
              />
              <span className="truncate">{suggestion}</span>
            </button>
          ))}
          {matches.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              No match — keep typing to add a new value.
            </p>
          )}
        </div>
        {isNewValue && matches.length > 0 && (
          <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
            Not in the list yet — saving keeps what you typed.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default SuggestionInput;
