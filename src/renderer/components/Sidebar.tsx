import { MainNav } from 'renderer/components/MainNav';
import { Sidebar as ShadSidebar } from 'renderer/shad/ui/sidebar';
import { Button } from 'renderer/shad/ui/button';
import { Link, Outlet } from 'react-router-dom';
import { FileCheck2, Plus, Table2, FileText, Store } from 'lucide-react';
import { PropsWithChildren } from 'react';

const Sidebar: React.FC<PropsWithChildren> = ({
  children,
}: PropsWithChildren) => {
  return (
    <div className="flex space-x-4 min-h-screen">
      <ShadSidebar
        title={<h1 className="text-xl font-semibold ">Easy Accounting</h1>}
        itemsClassName="w-full xs:w-[200px] md:w-[300px]"
        items={[
          <Link to="/accounts">
            <Button
              variant="outline"
              className="w-full md:w-[225px] gap-2 justify-start"
            >
              <Table2 />
              <span>Accounts</span>
            </Button>
          </Link>,
          <div className="flex flex-row">
            <Button variant="outline" className="w-full md:w-[225px] pl-2">
              <Link
                to="/journals"
                className="w-5/6 flex items-center justify-start gap-2"
              >
                <FileCheck2 />
                <span>Journals</span>
              </Link>
              <Link to="/journals/new">
                <Plus
                  size="20"
                  strokeWidth={4}
                  className="p-1 rounded-full font-black dark:bg-gray-300 dark:text-black bg-gray-500 text-white"
                />
              </Link>
            </Button>
          </div>,
          <Link to="/inventory">
            <Button
              variant="outline"
              className="w-full md:w-[225px] gap-2 justify-start"
            >
              <Store />
              <span>Inventory</span>
            </Button>
          </Link>,
          <div className="flex flex-row">
            <Button
              variant="outline"
              className="w-full md:w-[225px] pl-2"
              onClick={() => window.electron.store.delete('generatedInvoices')}
            >
              <Link
                to="/purchase/invoices"
                className="w-5/6 flex items-center justify-start gap-2"
              >
                <FileText />
                <span>Purchase Invoices</span>
              </Link>
              <Link to="/purchase/invoices/new">
                <Plus
                  size="20"
                  strokeWidth={4}
                  className="p-1 rounded-full font-black dark:bg-gray-300 dark:text-black bg-gray-500 text-white"
                />
              </Link>
            </Button>
          </div>,
          <div className="flex flex-row">
            <Button
              variant="outline"
              className="w-full md:w-[225px] pl-2"
              onClick={() => window.electron.store.delete('generatedInvoices')}
            >
              <Link
                to="/sale/invoices"
                className="w-5/6 flex items-center justify-start gap-2"
              >
                <FileText />
                <span>Sale Invoices</span>
              </Link>
              <Link to="/sale/invoices/new">
                <Plus
                  size="20"
                  strokeWidth={4}
                  className="p-1 rounded-full font-black dark:bg-gray-300 dark:text-black bg-gray-500 text-white"
                />
              </Link>
            </Button>
          </div>,
        ]}
        className="print:hidden"
      />
      <div className="flex-grow w-full mx-auto p-4">
        <MainNav className="print:hidden" />
        {children}
        <Outlet />
      </div>
    </div>
  );
};

export default Sidebar;
