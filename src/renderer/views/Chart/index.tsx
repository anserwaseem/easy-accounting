import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from 'renderer/shad/ui/button';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'renderer/shad/ui/dropdown-menu';

const ChartPage = () => {
  const [charts, setCharts] = useState<Chart[]>([]);
  const [typeSelected, setTypeSelected] = useState<
    'All' | 'Asset' | 'Liability' | 'Equity'
  >('All');

  const columns: ColumnDef<Chart>[] = [
    {
      accessorKey: 'name',
      header: 'Chart Name',
    },
    {
      accessorKey: 'code',
      header: 'Chart Code',
    },
    {
      accessorKey: 'type',
      header: 'Chart Type',
    },
    {
      accessorKey: 'updatedAt',
      header: 'Updated At',
      cell: ({ row }) =>
        new Date(row.original.updatedAt).toLocaleString('en-US'),
    },
    {
      accessorKey: 'createdAt',
      header: 'Created At',
      cell: ({ row }) =>
        new Date(row.original.createdAt).toLocaleString('en-US'),
    },
  ];

  useEffect(
    () =>
      void (async () =>
        setCharts(
          await window.electron.getCharts(localStorage.getItem('username')),
        ))(),
    [],
  );

  const getCharts = () => {
    switch (typeSelected) {
      case 'Asset':
        return charts.filter((chart) => chart.type === 'Asset');
      case 'Liability':
        return charts.filter((chart) => chart.type === 'Liability');
      case 'Equity':
        return charts.filter((chart) => chart.type === 'Equity');
      default:
        return charts;
    }
  };

  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="lg">
            <span className="mr-2">{typeSelected} Accounts</span>
            {/* <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" /> */}
            <ChevronDown size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="px-4">
          <DropdownMenuItem onClick={() => setTypeSelected('All')}>
            All Accounts
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTypeSelected('Asset')}>
            Asset Accounts
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTypeSelected('Liability')}>
            Liability Accounts
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTypeSelected('Equity')}>
            Equity Accounts
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="py-10 pr-4">
        <DataTable columns={columns} data={getCharts()} />
      </div>
    </div>
  );
};

export default ChartPage;
