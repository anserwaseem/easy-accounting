import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ChevronDown, Plus } from 'lucide-react';
import { toString } from 'lodash';
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
import { dateFormatOptions } from 'renderer/lib/constants';
import { EditDialog } from './editDialog';
import { defaultSortingFunctions } from 'renderer/lib/utils';

const AccountsPage = () => {
  console.log('AccountPage');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [typeSelected, setTypeSelected] = useState<
    'All' | 'Asset' | 'Liability' | 'Equity'
  >(window.electron.store.get('accountTypeSelected') || 'All');
  const [charts, setCharts] = useState<Chart[]>([]);
  const [accountHead, setAccountHead] = useState(
    toString(window.electron.store.get('createAccountHeadSelected')),
  );

  const [openCreateForm, setOpenCreateForm] = useState(false);
  const { toast } = useToast();
  const clearRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  const createFormSchema = z.object({
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

  const createForm = useForm<z.infer<typeof createFormSchema>>({
    resolver: zodResolver(createFormSchema),
    defaultValues: defaultCreateValues,
  });

  const columns: ColumnDef<Account>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'Account Name',
        onClick: (row) => navigate(`/account/${row.original.id}`),
      },
      {
        accessorKey: 'headName',
        header: 'Head Name',
        onClick: (row) => navigate(`/account/${row.original.id}`),
      },
      {
        accessorKey: 'type',
        header: 'Type',
        onClick: (row) => navigate(`/account/${row.original.id}`),
      },
      {
        accessorKey: 'code',
        header: 'Account Code',
        onClick: (row) => navigate(`/account/${row.original.id}`),
      },
      {
        accessorKey: 'updatedAt',
        header: 'Updated At',
        cell: ({ row }) =>
          new Date(row.original.updatedAt || '').toLocaleString(
            'en-US',
            dateFormatOptions,
          ),
        onClick: (row) => navigate(`/account/${row.original.id}`),
      },
      {
        accessorKey: 'createdAt',
        header: 'Created At',
        cell: ({ row }) =>
          new Date(row.original.createdAt || '').toLocaleString(
            'en-US',
            dateFormatOptions,
          ),
        onClick: (row) => navigate(`/account/${row.original.id}`),
      },
      {
        header: 'Edit',
        cell: ({ row }) => (
          <EditDialog
            row={row}
            setAccounts={setAccounts}
            setCharts={setCharts}
            charts={charts}
            clearRef={clearRef}
          />
        ),
      },
    ],
    [accounts, charts],
  );

  useEffect(() => {
    if (!openCreateForm) {
      (async () => {
        createForm.setValue('headName', accountHead);
        setAccounts(await window.electron.getAccounts());
        setCharts(await window.electron.getCharts());
      })();
    }
  }, [openCreateForm]);

  useEffect(
    () => window.electron.store.set('accountTypeSelected', typeSelected),
    [typeSelected],
  );

  useEffect(
    () => window.electron.store.set('createAccountHeadSelected', accountHead),
    [accountHead],
  );

  const getAccounts = useCallback(() => {
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
  }, [accounts, typeSelected]);

  const onSubmit = async (values: z.infer<typeof createFormSchema>) => {
    const res = await window.electron.insertAccount({
      name: values.accountName,
      headName: values.headName,
      code: values.accountCode,
    });

    if (res) {
      clearRef.current?.click();
      setOpenCreateForm(false);
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
    <div>
      <div className="flex justify-between items-center py-4 pr-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
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
        <DataTable
          columns={columns}
          data={getAccounts()}
          defaultSortField="id"
          sortingFns={defaultSortingFunctions}
        />
      </div>
    </div>
  );
};

export default AccountsPage;
