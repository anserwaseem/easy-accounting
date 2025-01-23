import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from 'renderer/shad/ui/dialog';
import { Input } from 'renderer/shad/ui/input';
import { Button } from 'renderer/shad/ui/button';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from 'renderer/shad/ui/form';
import { useToast } from 'renderer/shad/ui/use-toast';
import { useState } from 'react';

interface AddInventoryItemProps {
  refetchInventory: () => void;
  clearRef: React.RefObject<HTMLButtonElement>;
}

export const AddInventoryItem: React.FC<AddInventoryItemProps> = ({
  refetchInventory,
  clearRef,
}: AddInventoryItemProps) => {
  const { toast } = useToast();

  const [openCreateForm, setOpenCreateForm] = useState(false);

  const addFormSchema = z.object({
    name: z.string().min(1),
    price: z.coerce.number().positive(),
    description: z.string().optional(),
  });

  const defaultCreateValues = {
    name: '',
    description: '',
    price: 0,
  };

  const createForm = useForm<z.infer<typeof addFormSchema>>({
    resolver: zodResolver(addFormSchema),
    defaultValues: defaultCreateValues,
  });

  const onSubmit = async (values: z.infer<typeof addFormSchema>) => {
    const res = await window.electron.insertInventoryItem({ ...values });

    if (res) {
      clearRef.current?.click();
      setOpenCreateForm(false);
      refetchInventory();
      toast({
        description: 'Inventory Item created successfully',
        variant: 'success',
      });
    } else {
      toast({
        description: 'Inventory Item not created',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={openCreateForm} onOpenChange={setOpenCreateForm}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus size={16} />
          <span className="ml-3 mr-1">New Inventory Item</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Inventory Item</DialogTitle>
        </DialogHeader>

        <Form {...createForm}>
          <form
            onSubmit={createForm.handleSubmit(onSubmit)}
            onReset={() => createForm.reset(defaultCreateValues)}
          >
            <FormField
              control={createForm.control}
              name="name"
              render={({ field }) => (
                <FormItem labelPosition="start">
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createForm.control}
              name="price"
              render={({ field }) => (
                <FormItem labelPosition="start">
                  <FormLabel>Price</FormLabel>
                  <FormControl>
                    <Input {...field} type="number" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createForm.control}
              name="description"
              render={({ field }) => (
                <FormItem labelPosition="start">
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-between">
              <Button type="submit" className="w-1/2">
                Submit
              </Button>
              <Button type="reset" variant="ghost" ref={clearRef}>
                Clear
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
