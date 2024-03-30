import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { keys, get } from 'lodash';
import { PenBox, ChevronDown } from 'lucide-react';
import { Form } from 'renderer/shad/ui/form';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from 'renderer/shad/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'renderer/shad/ui/dropdown-menu';
import { Input } from 'renderer/shad/ui/input';
import { Button } from 'renderer/shad/ui/button';
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from 'renderer/shad/ui/form';
import { useToast } from 'renderer/shad/ui/use-toast';

interface EditDialogProps {
  row: {
    original: UpdateAccount;
  };
  setAccounts: React.Dispatch<React.SetStateAction<Account[]>>;
  setCharts: React.Dispatch<React.SetStateAction<Chart[]>>;
  charts: Chart[];
  clearRef: React.RefObject<HTMLButtonElement>;
}

export const EditDialog: React.FC<EditDialogProps> = ({
  row,
  setAccounts,
  setCharts,
  charts,
  clearRef,
}) => {
  const { toast } = useToast();

  const editFormSchema = z.object({
    id: z.number(),
    headName: z.string().min(2).max(50),
    name: z.string().min(2).max(50),
    code: z
      .string()
      .nullable()
      .refine(
        (val) => val === null || val === '' || !isNaN(parseFloat(val)), // TODO: it allows parsing of strings like '3s' i.e. string starting with a number. Fix this.
        'Code must be a number',
      )
      .transform((val) =>
        val !== null && val !== '' ? parseFloat(val) : undefined,
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

  const handleLoadEditForm = (row: UpdateAccount) => {
    keys(defaultEditValues).forEach((key) =>
      editForm.setValue(key as keyof UpdateAccount, get(row, key) || ''),
    );
  };

  const onEdit = async (values: z.infer<typeof editFormSchema>) => {
    const res = await window.electron.updateAccount({
      id: values.id,
      name: values.name,
      headName: values.headName,
      code: values.code,
    });

    if (res) {
      setAccounts(await window.electron.getAccounts());
      setCharts(await window.electron.getCharts());
      toast({
        description: 'Account updated successfully',
        variant: 'default',
      });
    } else {
      toast({
        description: 'Account not updated',
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
        <Button
          variant="outline"
          onClick={() => handleLoadEditForm(row.original)}
        >
          <PenBox size={16} />
          <span className="ml-3 mr-1">Edit Account</span>
        </Button>
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
                    <DropdownMenu {...field}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-between"
                        >
                          <span className="mr-2">{field.value}</span>
                          <ChevronDown size={16} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="center" className="px-4">
                        {charts.map((chart) => (
                          <DropdownMenuItem
                            onClick={() =>
                              editForm.setValue('headName', chart.name)
                            }
                          >
                            {chart.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
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
              <Button type="reset" variant={'ghost'} ref={clearRef}>
                Clear
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
