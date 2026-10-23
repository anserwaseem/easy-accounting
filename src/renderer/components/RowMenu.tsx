import { MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from 'renderer/shad/ui/dropdown-menu';
import { Button } from 'renderer/shad/ui/button';

interface RowMenuProps {
  /** what the menu does, for the button's label and tooltip */
  label?: string;
  /** the menu's contents */
  children: React.ReactNode;
}

/**
 * The row's control on a card: a vertical ⋮ at the end of the
 * headline row.
 *
 * A card has room for one control, so everything the row can do sits
 * behind it. The trigger is a plain button, not a menu the caller
 * owns, so the menu and whatever it opens (a dialog) can live
 * together: a dialog opened from a menu item must be mounted outside
 * the menu, or closing the menu unmounts it.
 */
export const RowMenu: React.FC<RowMenuProps> = ({
  label = 'Row actions',
  children,
}: RowMenuProps) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
        title={label}
        aria-label={label}
      >
        <MoreVertical className="h-4 w-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-48">
      {children}
    </DropdownMenuContent>
  </DropdownMenu>
);
