import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toString, isNaN } from 'lodash';
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
import { toast } from 'renderer/shad/ui/use-toast';
import type { Chart } from 'types';
import { useEffect, useState } from 'react';
import { ChartSelect } from 'renderer/components/ChartSelect';

interface AddAccountProps {
  refetchAccounts: () => void;
  charts: Chart[];
  clearRef: React.RefObject<HTMLButtonElement>;
}

export const AddAccount: React.FC<AddAccountProps> = ({
  refetchAccounts,
  charts,
  clearRef,
}: AddAccountProps) => {
  const [openCreateForm, setOpenCreateForm] = useState(false);
  const [accountHead, setAccountHead] = useState(
    toString(window.electron.store.get('createAccountHeadSelected')),
  );

  const addFormSchema = z.object({
    headName: z.string().min(2).max(50),
    accountName: z.string().min(2).max(50),
    accountCode: z
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

  const defaultCreateValues = {
    headName: '',
    accountName: '',
    accountCode: undefined,
  };

  const createForm = useForm<z.infer<typeof addFormSchema>>({
    resolver: zodResolver(addFormSchema),
    defaultValues: defaultCreateValues,
  });

  useEffect(
    () => createForm.setValue('headName', accountHead),
    [accountHead, createForm],
  );

  useEffect(
    () => window.electron.store.set('createAccountHeadSelected', accountHead),
    [accountHead],
  );

  const onSubmit = async (values: z.infer<typeof addFormSchema>) => {
    const res = await window.electron.insertAccount({
      name: values.accountName,
      headName: values.headName,
      code: values.accountCode,
    });

    if (res) {
      clearRef.current?.click();
      setOpenCreateForm(false);
      refetchAccounts();
      toast({
        description: `"${values.accountName}" account created successfully`,
        variant: 'success',
      });
    } else {
      toast({
        description: `Failed to create "${values.accountName}" account`,
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={openCreateForm} onOpenChange={setOpenCreateForm}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full min-w-max">
          <Plus className="mr-2 h-4 w-4" />
          New Account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Account</DialogTitle>
          <DialogTitle>Create New Account</DialogTitle>
        </DialogHeader>
        <Form {...createForm}>
          <form
            onSubmit={createForm.handleSubmit(onSubmit)}
            onReset={() => {
              createForm.reset(defaultCreateValues);
              setAccountHead('');
            }}
          >
            <FormField
              control={createForm.control}
              name="headName"
              render={({ field }) => (
                <FormItem labelPosition="start">
                  <FormLabel>Account Head</FormLabel>
                  <FormControl>
                    <ChartSelect
                      charts={charts}
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        setAccountHead(value);
                      }}
                    />
                    <ChartSelect
                      charts={charts}
                      value={field.value}
                      onValueChange={(value) => {
                        field.onChange(value);
                        setAccountHead(value);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={createForm.control}
              name="accountName"
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
              control={createForm.control}
              name="accountCode"
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
