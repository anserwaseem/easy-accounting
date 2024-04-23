import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toString } from 'lodash';
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
import { Button } from 'renderer/shad/ui/button';
import { DataTable, type ColumnDef } from 'renderer/shad/ui/dataTable';
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  Form,
} from 'renderer/shad/ui/form';
import { useToast } from 'renderer/shad/ui/use-toast';
import { Input } from 'renderer/shad/ui/input';
import { defaultSortingFunctions } from 'renderer/lib/utils';

interface MiniAccountPageProps {
  accountId: number;
  setAccountName: (name: string) => void;
  setHeadName: (name: string) => void;
}

export const MiniAccountPage: React.FC<MiniAccountPageProps> = ({
  accountId,
  setAccountName,
  setHeadName,
}) => {
  console.log('MiniAccountPage');
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

  const columns: ColumnDef<Pick<Account, 'id' | 'name' | 'type'>>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'Account Name',
        cell: ({ row }) => (
          <div>
            <h2>{row.original.name}</h2>
            <p className="text-xs text-slate-400">{row.original.type}</p>
          </div>
        ),
        onClick: (row) => navigate(`/account/${row.original.id}`),
      },
    ],
    [accounts, charts],
  );

  useEffect(() => {
    if (!openCreateForm) {
      (async () => {
        createForm.setValue('headName', accountHead);
        const accounts = (await window.electron.getAccounts()) as Account[];
        const selectedAccount = accounts.find(
          (account) => account.id === accountId,
        );
        setAccounts(accounts);
        setAccountName(selectedAccount?.name || '');
        setHeadName(selectedAccount?.headName || '');
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
        variant: 'default',
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
