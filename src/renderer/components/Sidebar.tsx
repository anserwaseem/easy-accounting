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

const sidebarLinkButtonClass = 'w-full md:w-[225px] gap-2 justify-start';

const sidebarSplitRowButtonClass = 'w-full md:w-[225px] pl-2';

const sidebarNewShortcutIconClass =
  'p-1 rounded-full font-black dark:bg-gray-300 dark:text-black bg-gray-500 text-white';

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
    <Button variant="outline" className={sidebarLinkButtonClass}>
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
  onOuterButtonClick?: () => void;
}

const SidebarListPlusNewRow: FC<SidebarListPlusNewRowProps> = ({
  listTo,
  newTo,
  icon,
  label,
  onOuterButtonClick,
}: SidebarListPlusNewRowProps) => (
  <div className="flex flex-row">
    <Button
      variant="outline"
      className={sidebarSplitRowButtonClass}
      onClick={onOuterButtonClick}
    >
      <Link to={listTo} className="w-5/6 flex items-center justify-start gap-2">
        {icon}
        <span>{label}</span>
      </Link>
      <Link to={newTo}>
        <Plus
          size={20}
          strokeWidth={4}
          className={sidebarNewShortcutIconClass}
        />
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
            onOuterButtonClick={clearGeneratedInvoicesFromStore}
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
            onOuterButtonClick={clearGeneratedInvoicesFromStore}
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
