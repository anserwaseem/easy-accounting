import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from 'renderer/shad/ui/dialog';
import { Button } from 'renderer/shad/ui/button';
import { toast } from 'renderer/shad/ui/use-toast';
import type { Chart } from 'types';
import { useState } from 'react';
import { toString } from 'lodash';
import { cn } from '@/renderer/lib/utils';
import { AccountForm, type AccountFormData } from './accountForm';

interface AddAccountProps {
  refetchAccounts: () => void;
  charts: Chart[];
  clearRef: React.RefObject<HTMLButtonElement>;
  btnClassName?: string;
}

export const AddAccount: React.FC<AddAccountProps> = ({
  refetchAccounts,
  charts,
  clearRef,
  btnClassName,
}: AddAccountProps) => {
  const [openCreateForm, setOpenCreateForm] = useState(false);
  const [accountHead, setAccountHead] = useState(
    toString(window.electron.store.get('createAccountHeadSelected')),
  );

  const onSubmit = async (values: AccountFormData) => {
    const res = await window.electron.insertAccount({
      name: values.accountName,
      headName: values.headName,
      code: values.accountCode,
      address: values.address,
      phone1: values.phone1,
      phone2: values.phone2,
      goodsName: values.goodsName,
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
        <Button
          variant="outline"
          className={cn('w-full min-w-max', btnClassName)}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Account</DialogTitle>
        </DialogHeader>
        <AccountForm
          onSubmit={onSubmit}
          charts={charts}
          clearRef={clearRef}
          initialValues={{ headName: accountHead }}
          onHeadNameChange={(value) => {
            setAccountHead(value);
            window.electron.store.set('createAccountHeadSelected', value);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
