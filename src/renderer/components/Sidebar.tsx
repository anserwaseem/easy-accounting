import { MainNav } from 'renderer/components/MainNav';
import { useAppNavigationShortcuts } from '@/renderer/hooks/useAppNavigationShortcuts';
import { Sidebar as ShadSidebar } from 'renderer/shad/ui/sidebar';
import { Button } from 'renderer/shad/ui/button';
import { Link, Outlet } from 'react-router-dom';
import {
  BarChart3,
  FileCheck2,
  FileInput,
  FileOutput,
  Plus,
  Quote,
  Store,
  Table2,
  TextQuote,
} from 'lucide-react';
import type { FC, PropsWithChildren, ReactNode } from 'react';
import { cn } from 'renderer/lib/utils';

const ITEM_BUTTON_CLASSNAME = 'px-3';

const sidebarPlusIconButtonClassName = cn(
  'shrink-0 bg-primary/10 text-primary hover:bg-primary/20 transition-all duration-150 hover:scale-105 active:scale-95',
  ITEM_BUTTON_CLASSNAME,
);

interface SidebarOutlineLinkProps {
  to: string;
  icon: ReactNode;
  label: string;
}

const SidebarOutlineLink: FC<SidebarOutlineLinkProps> = ({
  to,
  icon,
  label,
}: SidebarOutlineLinkProps) => (
  <Link to={to}>
    <Button
      variant="outline"
      className={cn(
        'w-full md:w-[225px] gap-2 justify-start',
        ITEM_BUTTON_CLASSNAME,
      )}
    >
      {icon}
      <span>{label}</span>
    </Button>
  </Link>
);

interface SidebarListPlusNewRowProps {
  listTo: string;
  newTo: string;
  icon: ReactNode;
  label: string;
  /** e.g. clear cached generated invoice numbers when opening purchase/sale lists */
  onListButtonClick?: () => void;
}

const SidebarListPlusNewRow: FC<SidebarListPlusNewRowProps> = ({
  listTo,
  newTo,
  icon,
  label,
  onListButtonClick,
}: SidebarListPlusNewRowProps) => (
  <div className="flex flex-row w-full md:w-[225px]">
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
    <Button
      asChild
      size="icon"
      variant="outline"
      className={sidebarPlusIconButtonClassName}
    >
      <Link to={newTo}>
        <Plus size={18} strokeWidth={2.5} />
      </Link>
    </Button>
  </div>
);

const clearGeneratedInvoicesFromStore = () => {
  window.electron.store.delete('generatedInvoices');
};

const Sidebar: FC<PropsWithChildren> = ({ children }: PropsWithChildren) => {
  useAppNavigationShortcuts();

  return (
    <div className="flex space-x-4 h-screen overflow-hidden">
      <ShadSidebar
        title={<h1 className="text-xl font-semibold ">Easy Accounting</h1>}
        itemsClassName="w-full xs:w-[200px] md:w-[300px]"
        items={[
          <SidebarOutlineLink
            key="accounts"
            to="/accounts"
            icon={<Table2 />}
            label="Accounts"
          />,
          <SidebarListPlusNewRow
            key="journals"
            listTo="/journals"
            newTo="/journals/new"
            icon={<FileCheck2 />}
            label="Journals"
          />,
          <SidebarOutlineLink
            key="inventory"
            to="/inventory"
            icon={<Store />}
            label="Inventory"
          />,
          <SidebarListPlusNewRow
            key="purchase-invoices"
            listTo="/purchase/invoices"
            newTo="/purchase/invoices/new"
            icon={<FileInput />}
            label="Purchase Invoices"
            onListButtonClick={clearGeneratedInvoicesFromStore}
          />,
          <SidebarOutlineLink
            key="purchase-quotations"
            to="/purchase/quotations"
            icon={<TextQuote />}
            label="Purchase Quotations"
          />,
          <SidebarListPlusNewRow
            key="sale-invoices"
            listTo="/sale/invoices"
            newTo="/sale/invoices/new"
            icon={<FileOutput />}
            label="Sale Invoices"
            onListButtonClick={clearGeneratedInvoicesFromStore}
          />,
          <SidebarOutlineLink
            key="sale-quotations"
            to="/sale/quotations"
            icon={<Quote />}
            label="Sale Quotations"
          />,
          <SidebarOutlineLink
            key="reports"
            to="/reports"
            icon={<BarChart3 />}
            label="Reports"
          />,
        ]}
        className="print:hidden h-full"
      />
      <div className="flex flex-col flex-grow min-w-0 w-full mx-auto">
        <MainNav className="print:hidden flex-shrink-0" />
        <div className="flex-grow overflow-y-auto p-4">
          {children}
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
