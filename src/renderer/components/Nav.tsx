import { MainNav } from 'renderer/shad/ui/main-nav';
import { Sidebar } from 'renderer/shad/ui/sidebar';
import { Button } from 'renderer/shad/ui/button';
import { Link } from 'react-router-dom';
import { BarChartBig } from 'lucide-react';
import { PropsWithChildren } from 'react';

const Nav: React.FC<PropsWithChildren> = ({ children }) => {
  return (
    <div className="flex space-x-4 min-h-screen">
      <Sidebar
        title={
          <h1 className="text-xl font-semibold text-white">Easy Accounting</h1>
        }
        titleClassName="bg-background"
        itemsClassName="w-full xs:w-[200px] md:w-[300px]"
        items={[
          <Link to="/account">
            <Button variant="outline" className="w-full">
              <BarChartBig />
              <span>Accounts</span>
            </Button>
          </Link>,
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
