import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { keys, get } from 'lodash';
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
import type { UpdateAccount, Chart } from 'types';
import { ChartSelect } from 'renderer/components/ChartSelect';

interface EditAccountProps {
  row: {
    original: UpdateAccount;
  };
  refetchAccounts: () => void;
  charts: Chart[];
  clearRef: React.RefObject<HTMLButtonElement>;
}

export const EditAccount: React.FC<EditAccountProps> = ({
  row,
  refetchAccounts,
  charts,
  clearRef,
}: EditAccountProps) => {
  const editFormSchema = z.object({
    id: z.number(),
    headName: z.string().min(2).max(50),
    name: z.string().min(2).max(50),
    code: z.string().optional(),
    address: z.string().optional(),
    phone1: z.string().optional(),
    phone2: z.string().optional(),
    goodsName: z.string().optional(),
  });

  const defaultEditValues = {
    id: 0,
    headName: '',
    name: '',
    code: undefined,
    address: undefined,
    phone1: undefined,
    phone2: undefined,
    goodsName: undefined,
  };

  const editForm = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
    defaultValues: defaultEditValues,
  });

  const handleLoadEditForm = (inputRow: UpdateAccount) => {
    keys(defaultEditValues).forEach((key) =>
      editForm.setValue(key as keyof UpdateAccount, get(inputRow, key) || ''),
    );
  };

  const onEdit = async (values: z.infer<typeof editFormSchema>) => {
    const res = await window.electron.updateAccount({
      id: values.id,
      name: values.name,
      headName: values.headName,
      code: values.code,
      address: values.address,
      phone1: values.phone1,
      phone2: values.phone2,
      goodsName: values.goodsName,
    });

    if (res) {
      refetchAccounts();
      toast({
        description: `"${values.name}" account updated successfully`,
        variant: 'success',
      });
    } else {
      toast({
        description: `Failed to update "${values.name}" account`,
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
          <DialogTitle>Edit Account</DialogTitle>
        </DialogHeader>

        <Form {...editForm}>
          <form
            onSubmit={editForm.handleSubmit(onEdit)}
            onReset={() =>
              editForm.reset({
                ...defaultEditValues,
                id: row.original.id,
                code: '' as any,
              })
            }
          >
            <FormField
              control={editForm.control}
              name="headName"
              render={({ field }) => (
                <FormItem labelPosition="start">
                  <FormLabel>Account Head</FormLabel>
                  <FormControl>
                    <ChartSelect
                      charts={charts}
                      value={field.value}
                      onValueChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
              name="name"
              render={({ field }) => (
                <FormItem labelPosition="start">
                  <FormLabel>Account Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
              name="code"
              render={({ field }) => (
                <FormItem labelPosition="start">
                  <FormLabel>Account Code</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
              name="address"
              render={({ field }) => (
                <FormItem labelPosition="start">
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
              name="phone1"
              render={({ field }) => (
                <FormItem labelPosition="start">
                  <FormLabel>Phone 1</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
              name="phone2"
              render={({ field }) => (
                <FormItem labelPosition="start">
                  <FormLabel>Phone 2</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={editForm.control}
              name="goodsName"
              render={({ field }) => (
                <FormItem labelPosition="start">
                  <FormLabel>Goods Name</FormLabel>
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
