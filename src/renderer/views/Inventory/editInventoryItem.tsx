import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { keys, get, toNumber } from 'lodash';
import { PenBox } from 'lucide-react';
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
import { toast } from 'renderer/shad/ui/use-toast';
import type { UpdateInventoryItem } from '@/types';

interface EditInventoryItemProps {
  row: {
    original: UpdateInventoryItem;
  };
  refetchInventory: () => void;
}

export const EditInventoryItem: React.FC<EditInventoryItemProps> = ({
  row,
  refetchInventory,
}: EditInventoryItemProps) => {
  const editFormSchema = z.object({
    id: z.number(),
    name: z.string().optional(),
    quantity: z.number().optional(),
    price: z.coerce.number().positive(),
    description: z.string().optional(),
  });

  const defaultEditValues = {
    id: 0,
    name: '',
    quantity: 0,
    price: 0,
    description: '',
  };

  const editForm = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
    defaultValues: defaultEditValues,
  });

  const handleLoadEditForm = (inputRow: UpdateInventoryItem) => {
    keys(defaultEditValues).forEach((key) =>
      editForm.setValue(
        key as keyof UpdateInventoryItem,
        get(inputRow, key) || '',
      ),
    );
  };

  const onEdit = async (values: z.infer<typeof editFormSchema>) => {
    const res = await window.electron.updateInventoryItem({ ...values });

    if (res) {
      refetchInventory();
      toast({
        description: 'Inventory Item updated successfully',
        variant: 'success',
      });
    } else {
      toast({
        description: 'Inventory Item not updated',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          editForm.clearErrors();
        }
      }}
    >
      <DialogTrigger asChild>
        <PenBox
          size={16}
          onClick={() => handleLoadEditForm(row.original)}
          cursor="pointer"
          className="py-0"
        />
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Inventory Item</DialogTitle>
        </DialogHeader>

        <Form {...editForm}>
          <form
            onSubmit={editForm.handleSubmit(onEdit)}
            onReset={() =>
              editForm.reset({
                ...row.original,
                price: defaultEditValues.price,
                description: '',
              })
            }
          >
            <FormField
              control={editForm.control}
              name="name"
              disabled
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
              control={editForm.control}
              disabled
              name="quantity"
              render={({ field }) => (
                <FormItem labelPosition="start">
                  <FormLabel>Quantity</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      value={toNumber(field.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
              name="price"
              render={({ field }) => (
                <FormItem labelPosition="start">
                  <FormLabel>Price</FormLabel>
                  <FormControl>
                    <Input type="number" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
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
              <Button type="reset" variant="ghost">
                Clear
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
