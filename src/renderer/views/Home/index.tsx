import { MainNav } from 'renderer/shad/ui/main-nav';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from 'renderer/shad/ui/tabs';
import { GettingStarted } from './units/GettingStarted';

export default function Home() {
  return (
    <div className="space-x-4">
      <MainNav />

      <Tabs defaultValue="getting-started" className="w-[400px]">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="getting-started">Getting Started</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard">
          Your dashboard is empty. Add some widgets here.
        </TabsContent>
        <TabsContent value="getting-started">
          <GettingStarted />
        </TabsContent>
      </Tabs>
    </div>
  );
}
