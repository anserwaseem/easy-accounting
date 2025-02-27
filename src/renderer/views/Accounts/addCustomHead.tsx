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
}

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  parentId: z.number().min(1, 'Parent head is required'),
});

export const AddCustomHead: React.FC<AddCustomHeadProps> = ({
  charts,
  onHeadAdded,
  btnClassName,
}: AddCustomHeadProps) => {
  const [open, setOpen] = useState(false);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      parentId: 0,
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const parentChart = charts.find((c) => c.id === values.parentId);
    if (!parentChart) return;

    try {
      await window.electron.insertCustomHead({
        name: values.name,
        type: parentChart.type,
        parentId: values.parentId,
      });

      form.reset();
      setOpen(false);
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className={cn('w-full', btnClassName)}>
          <Plus className="mr-2 h-4 w-4" />
          New Head
        </Button>
      </DialogTrigger>
      <DialogContent>
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
                  <FormLabel>Head Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
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
      </DialogContent>
    </Dialog>
  );
};
