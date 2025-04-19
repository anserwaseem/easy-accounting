import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from 'renderer/shad/ui/tabs';
import { GettingStarted } from './GettingStarted';
import { Dashboard } from './Dashboard';

const Home: React.FC = () => (
  <Tabs defaultValue="dashboard">
    <TabsList>
      <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
      <TabsTrigger value="getting-started">Getting Started</TabsTrigger>
    </TabsList>
    <TabsContent value="dashboard">
      <Dashboard />
    </TabsContent>
    <TabsContent value="getting-started">
      <div className="flex flex-col gap-4">
        <div>
          Username: <strong>{window.electron.store.get('username')}</strong>
        </div>
        <GettingStarted />
      </div>
    </TabsContent>
  </Tabs>
);

export default Home;
