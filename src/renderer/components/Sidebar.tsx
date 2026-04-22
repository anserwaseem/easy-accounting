import { useAppNavigationShortcuts } from '@/renderer/hooks/useAppNavigationShortcuts';
import { getOsModifierLabel, Kbd, KbdGroup } from 'renderer/shad/ui/kbd';
import { Sidebar as ShadSidebar } from 'renderer/shad/ui/sidebar';
import { Button } from 'renderer/shad/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from 'renderer/shad/ui/tooltip';
import { Link, Outlet } from 'react-router-dom';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  FileInput,
  FileOutput,
  Home,
  LogOut,
  Plus,
  Quote,
  Settings,
  Store,
  Table2,
  TextQuote,
} from 'lucide-react';
import type { FC, PropsWithChildren, ReactNode } from 'react';
import { useState } from 'react';
import { cn } from 'renderer/lib/utils';
import { ModeToggle } from 'renderer/components/ModeToggle';
import { useCmdOrCtrlShortcut } from '../hooks/useCmdOrCtrlShortcut';
import { useAuth } from '../hooks';

const ITEM_BUTTON_CLASSNAME = 'px-3';

const sidebarPlusIconButtonClassName = cn(
  'shrink-0 bg-primary/10 text-primary hover:bg-primary/20 transition-all duration-150 hover:scale-105 active:scale-95',
  ITEM_BUTTON_CLASSNAME,
);

// ─── Outline link ─────────────────────────────────────────────────────────────

interface SidebarOutlineLinkProps {
  to: string;
  icon: ReactNode;
  label: string;
  collapsed: boolean;
}

const SidebarOutlineLink: FC<SidebarOutlineLinkProps> = ({
  to,
  icon,
  label,
  collapsed,
}: SidebarOutlineLinkProps) => {
  const btn = (
    <Button
      variant="outline"
      className={
        collapsed
          ? 'justify-center px-0 w-10 h-10'
          : 'w-full gap-2 justify-start px-3'
      }
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </Button>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link to={to}>{btn}</Link>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link to={to} className="w-full px-0">
      {btn}
    </Link>
  );
};

// ─── List + plus row ──────────────────────────────────────────────────────────

interface PlusShortcutConfig {
  digit: '1' | '2' | '3';
  /** lowercase phrase after "New", e.g. "journal", "purchase invoice" */
  noun: string;
}

interface SidebarListPlusNewRowProps {
  listTo: string;
  newTo: string;
  icon: ReactNode;
  label: string;
  /** e.g. clear cached generated invoice numbers when opening purchase/sale lists */
  onListButtonClick?: () => void;
  /** matches useAppNavigationShortcuts (⌘/Ctrl+digit) */
  plusShortcut?: PlusShortcutConfig;
  collapsed: boolean;
}

const SidebarListPlusNewRow: FC<SidebarListPlusNewRowProps> = ({
  listTo,
  newTo,
  icon,
  label,
  onListButtonClick,
  plusShortcut,
  collapsed,
}: SidebarListPlusNewRowProps) => {
  const mod = getOsModifierLabel();

  const plusButton = (
    <Button
      asChild
      size="icon"
      variant="outline"
      className={sidebarPlusIconButtonClassName}
    >
      <Link
        to={newTo}
        aria-label={
          plusShortcut
            ? `New ${plusShortcut.noun}, shortcut ${mod}+${plusShortcut.digit}`
            : `New ${label}`
        }
        className={cn(collapsed && '!px-2')}
      >
        <Plus size={18} strokeWidth={2.5} aria-hidden />
        {collapsed && plusShortcut && (
          <span className="text-base">{plusShortcut?.digit}</span>
        )}
      </Link>
    </Button>
  );

  const wrappedPlusButton = plusShortcut ? (
    <Tooltip>
      <TooltipTrigger asChild>{plusButton}</TooltipTrigger>
      <TooltipContent side="right">
        <p className="text-sm">
          New {plusShortcut.noun}{' '}
          <span className="text-muted-foreground">
            ({mod}+{plusShortcut.digit})
          </span>
        </p>
      </TooltipContent>
    </Tooltip>
  ) : (
    plusButton
  );

  if (collapsed) {
    // icon-only: stacked list icon above plus icon
    return (
      <div className="flex flex-col items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              variant="outline"
              className="justify-center px-0 w-10 h-10"
              onClick={onListButtonClick}
            >
              <Link to={listTo}>{icon}</Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
        {wrappedPlusButton}
      </div>
    );
  }

  return (
    <div className="flex flex-row w-full px-0">
      <Button
        asChild
        variant="outline"
        className={cn('flex-1 justify-start gap-2', ITEM_BUTTON_CLASSNAME)}
        onClick={onListButtonClick}
      >
        <Link to={listTo}>
          {icon}
          <span>{label}</span>
        </Link>
      </Button>
      {wrappedPlusButton}
    </div>
  );
};

// ─── Sidebar header ───────────────────────────────────────────────────────────

interface SidebarHeaderProps {
  collapsed: boolean;
}

const SidebarHeader: FC<SidebarHeaderProps> = ({
  collapsed,
}: SidebarHeaderProps) => {
  if (collapsed) {
    return (
      <div className="flex items-center justify-center h-14">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon">
              <Link to="/" aria-label="Go to home">
                <Home size={18} aria-hidden />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Home</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-14 px-4">
      <Link
        to="/"
        className="text-lg font-semibold hover:opacity-80 transition-opacity truncate"
        aria-label="Go to home"
      >
        Easy Accounting
      </Link>
    </div>
  );
};

// ─── Sidebar footer ───────────────────────────────────────────────────────────

interface SidebarFooterProps {
  collapsed: boolean;
  onToggle: () => void;
  onLogout: () => void;
}

const SidebarFooter: FC<SidebarFooterProps> = ({
  collapsed,
  onToggle,
  onLogout,
}: SidebarFooterProps) => {
  const mod = getOsModifierLabel();
  // collapsed: only show the expand chevron
  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggle}
              aria-label="Expand sidebar"
              type="button"
            >
              <ChevronRight size={16} aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <KbdGroup>
              Expand sidebar <Kbd>{mod}</Kbd> + <Kbd>]</Kbd>
            </KbdGroup>
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  // expanded: collapse button (full-width, left-aligned) + icon-only action row
  return (
    <div className="flex flex-col py-2 px-0 gap-1">
      {/* icon-only single row */}
      <div className="flex items-center gap-1 px-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon">
              <Link to="/settings" aria-label="Settings">
                <Settings size={18} aria-hidden />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Settings</TooltipContent>
        </Tooltip>
        <ModeToggle />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onLogout}
              aria-label="Log out"
              type="button"
            >
              <LogOut size={18} aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Log Out</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              onClick={onToggle}
              className="gap-2"
              aria-label="Collapse sidebar border-0"
              type="button"
            >
              <ChevronLeft size={16} aria-hidden />
              <span>Collapse</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <KbdGroup>
              Collapse <Kbd>{mod}</Kbd> + <Kbd>[</Kbd>
            </KbdGroup>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const clearGeneratedInvoicesFromStore = () => {
  window.electron.store.delete('generatedInvoices');
};

// ─── Layout ───────────────────────────────────────────────────────────────────

const Sidebar: FC<PropsWithChildren> = ({ children }: PropsWithChildren) => {
  useAppNavigationShortcuts();
  const { logout } = useAuth();

  // persist collapsed state across restarts
  const [collapsed, setCollapsed] = useState<boolean>(
    () => !!window.electron.store.get('sidebarCollapsed'),
  );

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.electron.store.set('sidebarCollapsed', next);
      return next;
    });
  };

  useCmdOrCtrlShortcut('[', () => {
    setCollapsed(true);
    window.electron.store.set('sidebarCollapsed', true);
  });

  useCmdOrCtrlShortcut(']', () => {
    setCollapsed(false);
    window.electron.store.set('sidebarCollapsed', false);
  });

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden">
        <ShadSidebar
          title={<SidebarHeader collapsed={collapsed} />}
          items={[
            <SidebarOutlineLink
              key="accounts"
              to="/accounts"
              icon={<Table2 size={18} />}
              label="Accounts"
              collapsed={collapsed}
            />,
            <SidebarListPlusNewRow
              key="journals"
              listTo="/journals"
              newTo="/journals/new"
              icon={<FileCheck2 size={18} />}
              label="Journals"
              plusShortcut={{ digit: '1', noun: 'journal' }}
              collapsed={collapsed}
            />,
            <SidebarOutlineLink
              key="inventory"
              to="/inventory"
              icon={<Store size={18} />}
              label="Inventory"
              collapsed={collapsed}
            />,
            <SidebarListPlusNewRow
              key="purchase-invoices"
              listTo="/purchase/invoices"
              newTo="/purchase/invoices/new"
              icon={<FileInput size={18} />}
              label="Purchase Invoices"
              onListButtonClick={clearGeneratedInvoicesFromStore}
              plusShortcut={{ digit: '2', noun: 'purchase invoice' }}
              collapsed={collapsed}
            />,
            <SidebarOutlineLink
              key="purchase-quotations"
              to="/purchase/quotations"
              icon={<TextQuote size={18} />}
              label="Purchase Quotations"
              collapsed={collapsed}
            />,
            <SidebarListPlusNewRow
              key="sale-invoices"
              listTo="/sale/invoices"
              newTo="/sale/invoices/new"
              icon={<FileOutput size={18} />}
              label="Sale Invoices"
              onListButtonClick={clearGeneratedInvoicesFromStore}
              plusShortcut={{ digit: '3', noun: 'sale invoice' }}
              collapsed={collapsed}
            />,
            <SidebarOutlineLink
              key="sale-quotations"
              to="/sale/quotations"
              icon={<Quote size={18} />}
              label="Sale Quotations"
              collapsed={collapsed}
            />,
            <SidebarOutlineLink
              key="reports"
              to="/reports"
              icon={<BarChart3 size={18} />}
              label="Reports"
              collapsed={collapsed}
            />,
          ]}
          footer={
            <SidebarFooter
              collapsed={collapsed}
              onToggle={toggleCollapsed}
              onLogout={logout}
            />
          }
          className="print:hidden h-full"
          collapsed={collapsed}
        />
        <div className="flex flex-col flex-grow min-w-0 overflow-hidden">
          <div className="flex-grow overflow-y-auto p-4">
            {children}
            <Outlet />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default Sidebar;
