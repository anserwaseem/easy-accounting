import { useState } from 'react';
import { Button } from '@/renderer/shad/ui/button';
import { format } from 'date-fns';
import { toast } from '@/renderer/shad/ui/use-toast';
import { AppDateInput } from '@/renderer/components/AppDateInput';

export const ExportInvoices = () => {
  const [startDate, setStartDate] = useState<string>();
  const [endDate, setEndDate] = useState<string>();

  const handleExport = async () => {
    try {
      const buffer = await window.electron.exportInvoices(startDate, endDate);
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Sale_Invoices_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);

      toast({
        title: 'Success',
        description: 'Excel file exported successfully.',
        variant: 'success',
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Error',
        description: 'Failed to export Excel file.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex flex-col space-y-4">
      <h2 className="text-2xl font-semibold">Export Sale Invoices to Excel</h2>
      <div className="flex space-x-4">
        <AppDateInput
          value={startDate ?? ''}
          onChange={setStartDate}
          placeholder="Start Date"
          aria-label="Start Date"
        />
        <AppDateInput
          value={endDate ?? ''}
          onChange={setEndDate}
          placeholder="End Date"
          aria-label="End Date"
        />
      </div>
      <Button onClick={handleExport}>Export to Excel</Button>
    </div>
  );
};
