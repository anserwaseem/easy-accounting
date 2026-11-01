import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from 'renderer/shad/ui/tabs';
import { GettingStarted } from './GettingStarted';
import { Dashboard } from './Dashboard';

const Home: React.FC = () => (
  <Tabs defaultValue="getting-started">
    <TabsList className="grid h-auto grid-cols-2">
      <TabsTrigger value="getting-started" className="min-h-[44px]">
        Getting Started
      </TabsTrigger>
      <TabsTrigger value="dashboard" className="min-h-[44px]">
        Dashboard
      </TabsTrigger>
    </TabsList>
    <TabsContent value="getting-started">
      <div className="flex flex-col gap-4">
        <div className="text-sm text-muted-foreground">
          Signed in as{' '}
          <span className="font-medium text-foreground">
            {window.electron.store.get('username')}
          </span>
        </div>
        <GettingStarted />
      </div>
    </TabsContent>
    <TabsContent value="dashboard">
      <Dashboard />
    </TabsContent>
  </Tabs>
);

export default Home;
