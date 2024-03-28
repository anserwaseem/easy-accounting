import { ChevronDown, PenBox, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { get, keys, toString } from 'lodash';

const AccountPage = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [typeSelected, setTypeSelected] = useState<
    'All' | 'Asset' | 'Liability' | 'Equity'
  >(window.electron.store.get('accountTypeSelected') || 'All');
  const [charts, setCharts] = useState<Chart[]>([]);
  const [accountHead, setAccountHead] = useState(
    toString(window.electron.store.get('createAccountHeadSelected')),
  );

  const [openEditForm, setOpenEditForm] = useState(false);
  const { toast } = useToast();
  const clearRef = useRef<HTMLButtonElement>(null);

  const createFormSchema = z.object({
    headName: z.string().min(2).max(50),
    accountName: z.string().min(2).max(50),
    accountCode: z
      .string()
      .nullable()
      .refine(
        (val) => val === null || val === '' || !isNaN(parseFloat(val)),
        'Code must be a number',
      )
      .transform((val) =>
        val !== null && val !== '' ? parseFloat(val) : undefined,
      )
      .refine((val) => val === undefined || val >= 0, {
        message: 'Number must be positive',
      }),
  });

  const editFormSchema = z.object({
    id: z.number(),
    headName: z.string().min(2).max(50),
    name: z.string().min(2).max(50),
    code: z
      .string()
      .nullable()
      .refine(
        (val) => val === null || val === '' || !isNaN(parseFloat(val)),
        'Code must be a number',
      )
      .transform((val) =>
        val !== null && val !== '' ? parseFloat(val) : undefined,
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

  const defaultEditValues = {
    id: 0,
    headName: '',
    name: '',
    code: undefined,
  };

  const createForm = useForm<z.infer<typeof createFormSchema>>({
    resolver: zodResolver(createFormSchema),
    defaultValues: defaultCreateValues,
  });

  const editForm = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
    defaultValues: defaultEditValues,
  });

  const handleLoadEditForm = (row: UpdateAccount) => {
    keys(defaultEditValues).forEach((key) =>
      editForm.setValue(key as keyof UpdateAccount, get(row, key) || ''),
    );
    setOpenEditForm(true);
  };

  const columns: ColumnDef<Account>[] = useMemo(
    () => [
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
      {
        header: 'Edit',
        cell: ({ row }) => (
          <Dialog
            open={openEditForm}
            onOpenChange={(isOpen) => {
              setOpenEditForm(isOpen);
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
                            <DropdownMenuContent
                              align="center"
                              className="px-4"
                            >
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
        ),
      },
    ],
    [accounts, charts, openEditForm],
  );

  useEffect(() => {
    if (!openEditForm) {
      (async () => {
        createForm.setValue('headName', accountHead);
        setAccounts(await window.electron.getAccounts());
        setCharts(await window.electron.getCharts());
      })();
    }
  }, [openEditForm]);

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

  const onSubmit = async (values: z.infer<typeof createFormSchema>) => {
    const res = await window.electron.insertAccount({
      name: values.accountName,
      headName: values.headName,
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

  const onEdit = async (values: z.infer<typeof editFormSchema>) => {
    console.log('onEdit', values);
    const res = await window.electron.updateAccount({
      id: values.id,
      name: values.name,
      headName: values.headName,
      code: values.code,
    });

    if (res) {
      setOpenEditForm(false);
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
        <DataTable columns={columns} data={getAccounts()} />
      </div>
    </div>
  );
};

export default AccountPage;
