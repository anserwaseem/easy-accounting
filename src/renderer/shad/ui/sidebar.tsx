import { Sheet } from './sheet';
import { ChevronRight } from 'lucide-react';

interface SidebarProps {
  sheet: React.ReactNode;
  isOpen: boolean;
  width: number;
  toggleWidth: () => void;
}

export const Sidebar = ({
  sheet,
  isOpen,
  width,
  toggleWidth,
}: SidebarProps) => {
  if (!isOpen) return null;

  return (
    <aside className="sidebar" style={{ width: `${width}px` }}>
      <Sheet>{sheet}</Sheet>

      <button className="toggle" onClick={toggleWidth}>
        <ChevronRight />
      </button>
    </aside>
  );
};
