import { ChevronDown, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from 'renderer/shad/ui/button';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'renderer/shad/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from 'renderer/shad/ui/dialog';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from 'renderer/shad/ui/form';
import { Input } from 'renderer/shad/ui/input';
import { useToast } from 'renderer/shad/ui/use-toast';

const AccountPage = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [typeSelected, setTypeSelected] = useState<
    'All' | 'Asset' | 'Liability' | 'Equity'
  >(window.electron.store.get('accountTypeSelected') || 'All');
  const [charts, setCharts] = useState<Chart[]>([]);
  const [accountHead, setAccountHead] = useState(
    window.electron.store.get('createAccountHeadSelected') || '',
  );
  const { toast } = useToast();
  const clearRef = useRef<HTMLButtonElement>(null);

  const columns: ColumnDef<Account>[] = [
    {
      accessorKey: 'name',
      header: 'Account Name',
    },
    {
      accessorKey: 'headName',
      header: 'Head Name',
    },
    {
      accessorKey: 'type',
      header: 'Type',
    },
    {
      accessorKey: 'code',
      header: 'Account Code',
    },
    {
      accessorKey: 'updatedAt',
      header: 'Updated At',
      cell: ({ row }) =>
        new Date(row.original.updatedAt).toLocaleString('en-US'),
    },
    {
      accessorKey: 'createdAt',
      header: 'Created At',
      cell: ({ row }) =>
        new Date(row.original.createdAt).toLocaleString('en-US'),
    },
  ];

  const formSchema = z.object({
    accountHead: z.string().min(2).max(50),
    accountName: z.string().min(2).max(50),
    accountCode: z.coerce.number().positive().max(99999999).optional(),
    accountDescription: z.string().max(5000).optional(),
  });

  const defaultValues = {
    accountHead: '',
    accountName: '',
    accountCode: undefined,
    accountDescription: '',
  };

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  useEffect(
    () =>
      void (async () => {
        form.setValue('accountHead', accountHead);
        setAccounts(await window.electron.getAccounts());
        setCharts(await window.electron.getCharts());
      })(),
    [],
  );

  useEffect(
    () => window.electron.store.set('accountTypeSelected', typeSelected),
    [typeSelected],
  );

  useEffect(
    () => window.electron.store.set('createAccountHeadSelected', accountHead),
    [accountHead],
  );

  const getAccounts = () => {
    switch (typeSelected) {
      case 'Asset':
        return accounts.filter((account) => account.type === 'Asset');
      case 'Liability':
        return accounts.filter((account) => account.type === 'Liability');
      case 'Equity':
        return accounts.filter((account) => account.type === 'Equity');
      default:
        return accounts;
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const res = await window.electron.insertAccount({
      name: values.accountName,
      headName: values.accountHead,
      code: values.accountCode,
    });

    if (res) {
      clearRef.current?.click();
      toast({
        description: 'Account created successfully',
        variant: 'default',
      });
    } else {
      toast({
        description: 'Account not created',
        variant: 'destructive',
      });
    }
  };

  const onReset = () => {
    form.reset(defaultValues);
    setAccountHead('');
  };

  const handleAccountHeadChange = (value: string) => {
    form.setValue('accountHead', value);
    setAccountHead(value);
  };

  return (
    <div>
      <div className="flex justify-between items-center py-4 px-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="lg">
              <span className="mr-2">{typeSelected} Accounts</span>
              <ChevronDown size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="px-4">
            <DropdownMenuItem onClick={() => setTypeSelected('All')}>
              All Accounts
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTypeSelected('Asset')}>
              Asset Accounts
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTypeSelected('Liability')}>
              Liability Accounts
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTypeSelected('Equity')}>
              Equity Accounts
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Dialog>
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

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                onReset={() => onReset()}
              >
                <FormField
                  control={form.control}
                  name="accountHead"
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
                              <span className="mr-2">{accountHead}</span>
                              <ChevronDown size={16} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="center" className="px-4">
                            {charts.map((chart) => (
                              <DropdownMenuItem
                                onClick={() =>
                                  handleAccountHeadChange(chart.name)
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
                  control={form.control}
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
                  control={form.control}
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
                <FormField
                  control={form.control}
                  name="accountDescription"
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
                  <Button type="reset" variant={'ghost'} ref={clearRef}>
                    Clear
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
      <div className="py-10 pr-4">
        <DataTable columns={columns} data={getAccounts()} />
      </div>
    </div>
  );
};

export default AccountPage;
