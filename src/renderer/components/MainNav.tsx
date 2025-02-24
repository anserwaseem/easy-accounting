import { Bell, History, LogOut, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from 'renderer/lib/utils';
import { ModeToggle } from 'renderer/components/ModeToggle';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from 'renderer/shad/ui/tooltip';
// import { Search } from '../shad/ui/search';
import { useAuth } from '../hooks';

export const MainNav = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) => {
  const { logout } = useAuth();

  return (
    <nav
      className={cn(
        'flex h-16 items-center justify-between w-full border-b px-4 lg:px-6 mb-2 border-gray-800 dark:border-gray-300',
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-center space-x-4 lg:space-x-6">
        <div className="text-sm font-medium transition-colors hover:text-primary">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Bell className="h-5 w-5 mt-2" />
              </TooltipTrigger>
              <TooltipContent>Notifications</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {/* <div className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
          <Search />
        </div> */}
      </div>

      <div className="ml-auto flex items-center space-x-4 lg:space-x-6">
        <div className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <History className="h-5 w-5" />
              </TooltipTrigger>
              <TooltipContent>History</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Link
          to="/settings"
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
        <button
          onClick={() => logout()}
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          type="button"
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <LogOut className="h-5 w-5" />
              </TooltipTrigger>
              <TooltipContent>Log Out</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </button>
        <ModeToggle />
      </div>
    </nav>
  );
};
