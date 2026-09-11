import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from 'renderer/shad/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from 'renderer/shad/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'renderer/shad/ui/select';
import { Input } from 'renderer/shad/ui/input';
import { Button } from 'renderer/shad/ui/button';
import { Plus } from 'lucide-react';
import { toast } from '@/renderer/shad/ui/use-toast';
import { cn } from '@/renderer/lib/utils';
import type { Chart } from '../../../types';

interface AddCustomHeadProps {
  charts: Chart[];
  onHeadAdded: () => void;
  btnClassName?: string;
  /** when true, omit trigger button (parent opens via isOpen) */
  hideButton?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  nameUrdu: z.string().optional(),
  parentId: z.number().min(1, 'Parent head is required'),
});

export const AddCustomHead: React.FC<AddCustomHeadProps> = ({
  charts,
  onHeadAdded,
  btnClassName,
  hideButton = false,
  isOpen,
  onOpenChange,
}: AddCustomHeadProps) => {
  const [open, setOpen] = useState(false);
  const dialogOpen = isOpen ?? open;
  const setDialogOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      nameUrdu: '',
      parentId: 0,
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const parentChart = charts.find((c) => c.id === values.parentId);
    if (!parentChart) return;

    try {
      await window.electron.insertCustomHead({
        name: values.name,
        nameUrdu: values.nameUrdu?.trim() || null,
        type: parentChart.type,
        parentId: values.parentId,
      });

      form.reset();
      setDialogOpen(false);
      onHeadAdded();

      toast({
        description: `"${values.name}" head created successfully`,
        variant: 'success',
      });
    } catch (error) {
      console.error('Failed to create custom head:', error);
      toast({
        description: `Failed to create "${values.name}" head`,
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      {!hideButton ? (
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn('w-auto', btnClassName)}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Head
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Head</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="parentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Parent Head</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(Number(value))}
                    defaultValue={field.value.toString()}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select parent head" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {charts
                        .filter((chart) => !chart.parentId) // only show main heads
                        .map((chart) => (
                          <SelectItem
                            key={chart.id}
                            value={chart.id.toString()}
                          >
                            {chart.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Head Name (English)</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="nameUrdu"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Head Name (Urdu)</FormLabel>
                  <FormControl>
                    <Input {...field} dir="rtl" lang="ur" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full">
              Create Head
            </Button>
          </form>
        </Form>
        {charts.some((chart) => chart.parentId) ? (
          <div className="space-y-3 border-t pt-4">
            <p className="text-sm font-medium">Existing heads</p>
            {charts
              .filter((chart) => chart.parentId)
              .map((head) => (
                <div className="flex flex-col gap-1.5" key={head.id}>
                  <Input
                    id={`customHeadName-${head.id}`}
                    key={`${head.id}:en:${head.name}`}
                    defaultValue={head.name}
                    placeholder="English name"
                    onBlur={async (event) => {
                      const next = event.target.value.trim();
                      if (!next) {
                        toast({
                          description: 'English head name cannot be empty',
                          variant: 'destructive',
                        });
                        event.target.value = head.name;
                        return;
                      }
                      if (next === head.name) return;
                      try {
                        await window.electron.updateCustomHeadName(
                          head.id,
                          next,
                        );
                        onHeadAdded();
                      } catch (error) {
                        console.error(
                          'Failed to update head English name',
                          error,
                        );
                        toast({
                          description: `Failed to update "${head.name}" English name`,
                          variant: 'destructive',
                        });
                      }
                    }}
                  />
                  <Input
                    id={`customHeadUrdu-${head.id}`}
                    key={`${head.id}:ur:${head.nameUrdu ?? ''}`}
                    defaultValue={head.nameUrdu ?? ''}
                    dir="rtl"
                    lang="ur"
                    placeholder="اردو نام برائے پرنٹ"
                    onBlur={async (event) => {
                      const next = event.target.value.trim() || null;
                      const current = head.nameUrdu?.trim() || null;
                      if (next === current) return;
                      try {
                        await window.electron.updateCustomHeadUrdu(
                          head.id,
                          next,
                        );
                        onHeadAdded();
                      } catch (error) {
                        console.error('Failed to update head Urdu name', error);
                        toast({
                          description: `Failed to update "${head.name}" Urdu name`,
                          variant: 'destructive',
                        });
                      }
                    }}
                  />
                </div>
              ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
