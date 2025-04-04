import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from 'renderer/shad/ui/tabs';
import { GettingStarted } from './units/GettingStarted';

const Home: React.FC = () => (
  <Tabs defaultValue="getting-started" className="w-[400px]">
    <TabsList>
      <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
      <TabsTrigger value="getting-started">Getting Started</TabsTrigger>
    </TabsList>
    <TabsContent value="dashboard">
      Username: {window.electron.store.get('username')}
    </TabsContent>
    <TabsContent value="getting-started">
      <GettingStarted />
    </TabsContent>
  </Tabs>
);

export default Home;
