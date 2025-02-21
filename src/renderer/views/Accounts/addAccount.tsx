import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toString, isNaN } from 'lodash';
import { ChevronDown, Plus } from 'lucide-react';
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
        description: 'Account created successfully',
        variant: 'success',
      });
    } else {
      toast({
        description: 'Account not created',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={openCreateForm} onOpenChange={setOpenCreateForm}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus size={16} />
          <span className="ml-3 mr-1">New Account</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Account</DialogTitle>
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
                            onClick={() => {
                              createForm.setValue('headName', chart.name);
                              setAccountHead(chart.name);
                            }}
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
