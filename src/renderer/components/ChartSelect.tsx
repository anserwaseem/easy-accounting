import type { Chart } from 'types';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'renderer/shad/ui/select';

interface ChartSelectProps {
  charts: Chart[];
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const baseItemStyles =
  'my-1 cursor-pointer flex items-center data-[highlighted]:bg-accent/50 hover:bg-accent/50';

export const ChartSelect: React.FC<ChartSelectProps> = ({
  charts,
  value,
  onValueChange,
  placeholder = 'Select head',
  className,
}: ChartSelectProps) => (
  <Select value={value} onValueChange={onValueChange}>
    <SelectTrigger className={className}>
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent>
      {charts
        .filter((chart) => !chart.parentId)
        .map((mainChart) => (
          <SelectGroup key={mainChart.id} className="[&_svg]:hidden">
            {/* Main head as a selectable item with distinct style */}
            <SelectItem
              value={mainChart.name}
              className={`${baseItemStyles} pl-4 py-2 font-semibold bg-muted/50`}
            >
              {mainChart.name}
            </SelectItem>

            {/* Custom heads under this main head */}
            {charts
              .filter((c) => c.parentId === mainChart.id)
              .map((customHead) => (
                <SelectItem
                  key={customHead.id}
                  value={customHead.name}
                  className={`${baseItemStyles} pl-8 border-l-2 border-muted ml-4`}
                >
                  {customHead.name}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
    </SelectContent>
  </Select>
);
