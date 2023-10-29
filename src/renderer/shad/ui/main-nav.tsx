import { Bell, History, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from 'renderer/lib/utils';
import { Search } from './search';
import { ModeToggle } from 'renderer/components/ModeToggle';

export function MainNav({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <nav
      className={cn(
        'flex h-16 items-center justify-between w-full border-b',
        className,
      )}
      {...props}
    >
      <div className="flex items-center space-x-4 lg:space-x-6">
        <Link
          to="#"
          className="text-sm font-medium transition-colors hover:text-primary"
        >
          <Bell className="h-5 w-5" />
        </Link>
        <Link
          to="#"
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <Search />
        </Link>
      </div>

      <div className="ml-auto flex items-center space-x-4 lg:space-x-6">
        <Link
          to="#"
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <History className="h-5 w-5" />
        </Link>
        <Link
          to="#"
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <Settings className="h-5 w-5" />
        </Link>
        <ModeToggle />
      </div>
    </nav>
  );
}
