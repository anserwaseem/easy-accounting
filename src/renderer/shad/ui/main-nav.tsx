import { Bell, History, LogOut, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from 'renderer/lib/utils';
import { Search } from './search';
import { ModeToggle } from 'renderer/components/ModeToggle';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from 'renderer/shad/ui/tooltip';

export function MainNav({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <nav
      className={cn(
        'flex h-16 items-center justify-between w-full border-b px-4 lg:px-6 mb-2',
        className,
      )}
      {...props}
    >
      <div className="flex items-center space-x-4 lg:space-x-6">
        <Link
          to="#"
          className="text-sm font-medium transition-colors hover:text-primary"
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Bell className="h-5 w-5" />
              </TooltipTrigger>
              <TooltipContent>Notifications</TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <History className="h-5 w-5" />
              </TooltipTrigger>
              <TooltipContent>History</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Link>
        <Link
          to="#"
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Settings className="h-5 w-5" />
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Link>
        <Link
          to={'/login'}
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <LogOut className="h-5 w-5" />
              </TooltipTrigger>
              <TooltipContent>Log Out</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Link>
        <ModeToggle />
      </div>
    </nav>
  );
}
