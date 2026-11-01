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
    <TabsList className="grid h-12 w-full grid-cols-2 gap-1">
      <TabsTrigger
        value="getting-started"
        className="min-h-[44px] px-2 text-sm"
      >
        Getting Started
      </TabsTrigger>
      <TabsTrigger value="dashboard" className="min-h-[44px] px-2 text-sm">
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
