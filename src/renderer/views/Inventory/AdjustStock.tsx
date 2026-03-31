import { Button } from '@/renderer/shad/ui/button';
import { Input } from '@/renderer/shad/ui/input';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from '@/renderer/shad/ui/dialog';
import { toast } from '@/renderer/shad/ui/use-toast';
import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { format } from 'date-fns';
import type { InventoryItem } from '@/types';
import { Label } from '@/renderer/shad/ui/label';
import { toLocalDateInputValue } from '@/renderer/lib/localDate';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/renderer/shad/ui/popover';
import { Calendar } from '@/renderer/shad/ui/calendar';

interface AdjustStockProps {
  item: InventoryItem;
  refetchInventory: () => void;
}

export const AdjustStock: React.FC<AdjustStockProps> = ({
  item,
  refetchInventory,
}: AdjustStockProps) => {
  const [open, setOpen] = useState(false);
  const [quantityDelta, setQuantityDelta] = useState(0);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(() => toLocalDateInputValue(new Date()));
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const selectedDate = useMemo(() => {
    if (!date) return undefined;
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return undefined;
    return d;
  }, [date]);

  const newQuantity = item.quantity + quantityDelta;

  const handleSubmit = async () => {
    if (newQuantity < 0) {
      toast({
        description: 'Resulting quantity cannot be negative',
        variant: 'destructive',
      });
      return;
    }
    const result = await window.electron.applyStockAdjustment({
      inventoryId: item.id,
      quantityDelta,
      reason: reason.trim(),
      date,
    });
    if (result.success) {
      refetchInventory();
      setOpen(false);
      setQuantityDelta(0);
      setReason('');
      setDate(toLocalDateInputValue(new Date()));
      toast({
        description: `Stock adjusted for ${item.name} successfully`,
        variant: 'success',
      });
    } else {
      toast({
        description: result.error ?? 'Failed to adjust stock',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Adjust stock"
        >
          <SlidersHorizontal size={16} />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Correct quantity for &quot;{item.name}&quot; (e.g. loss, damage, count
          correction). Current quantity: <strong>{item.quantity}</strong>
        </p>
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            Adjust by (e.g. -5 or +10)
          </Label>
          <Input
            type="number"
            value={quantityDelta === 0 ? '' : quantityDelta}
            placeholder="0"
            onChange={(e) =>
              setQuantityDelta(parseInt(e.target.value, 10) || 0)
            }
          />
          {newQuantity !== item.quantity && (
            <p className="text-xs text-muted-foreground">
              New quantity will be: {newQuantity}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Reason (recommended)</Label>
          <Input
            value={reason}
            placeholder="e.g. Damaged, Lost, Count correction"
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Date</Label>
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start font-normal"
              >
                {selectedDate ? format(selectedDate, 'MM/dd/yyyy') : '—'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => {
                  if (!d) return;
                  setDate(toLocalDateInputValue(d));
                  setDatePickerOpen(false);
                }}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={quantityDelta === 0 || newQuantity < 0}
          >
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
