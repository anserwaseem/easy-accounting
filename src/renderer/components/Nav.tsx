import { MainNav } from 'renderer/shad/ui/main-nav';
import { Sidebar } from 'renderer/shad/ui/sidebar';
import { Button } from 'renderer/shad/ui/button';
import { Link } from 'react-router-dom';
import { BarChartBig, Plus } from 'lucide-react';
import { PropsWithChildren } from 'react';

const Nav: React.FC<PropsWithChildren> = ({ children }) => {
  return (
    <div className="flex space-x-4 min-h-screen">
      <Sidebar
        title={<h1 className="text-xl font-semibold ">Easy Accounting</h1>}
        itemsClassName="w-full xs:w-[200px] md:w-[300px]"
        items={[
          <Link to="/accounts">
            <Button variant="outline" className="w-full md:w-[225px]">
              <BarChartBig />
              <span>Accounts</span>
            </Button>
          </Link>,
          <div className="flex flex-row">
            <Button variant="outline" className="w-full md:w-[225px]">
              <Link
                to="/journals"
                className="w-5/6 flex items-center justify-center pl-2"
              >
                <BarChartBig />
                <span>Journal</span>
              </Link>
              <Link to="/journals/new">
                <Plus
                  size={'20'}
                  strokeWidth={4}
                  className="p-1 rounded-full font-black dark:bg-gray-300 dark:text-black bg-gray-500 text-white"
                />
              </Link>
            </Button>
          </div>,
        ]}
      />
      <div className="flex-grow w-full mx-auto p-4">
        <MainNav />
        {children}
      </div>
    </div>
  );
};

export default Nav;
