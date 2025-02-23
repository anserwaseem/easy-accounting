import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { keys, get, isNaN } from 'lodash';
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
    code: z
      .string()
      .optional()
      .nullable()
      .refine(
        (val) =>
          val === undefined ||
          val === null ||
          val === '' ||
          !isNaN(parseFloat(val)),
        'Code must be a number',
      )
      .transform((val) =>
        val !== undefined && val !== null && val !== ''
          ? parseFloat(val)
          : undefined,
      )
      .refine((val) => val === undefined || val >= 0, {
        message: 'Number must be positive',
      }),
  });

  const defaultEditValues = {
    id: 0,
    headName: '',
    name: '',
    code: undefined,
  };

  const editForm = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
    defaultValues: defaultEditValues,
  });

  const handleLoadEditForm = (inputRow: UpdateAccount) => {
    keys(defaultEditValues).forEach((key) => {
      const value = get(inputRow, key);
      // convert number to string for the code field so that 0 is not displayed as empty string
      const formValue =
        key === 'code' && typeof value === 'number' ? value.toString() : value;
      editForm.setValue(key as keyof UpdateAccount, formValue);
    });
  };

  const onEdit = async (values: z.infer<typeof editFormSchema>) => {
    const res = await window.electron.updateAccount({
      id: values.id,
      name: values.name,
      headName: values.headName,
      code: values.code,
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
