import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from 'renderer/shad/ui/dialog';
import { Button } from 'renderer/shad/ui/button';
import type { Chart } from 'types';
import { useState, useEffect } from 'react';
import { toString } from 'lodash';
import { cn, handleAsync } from '@/renderer/lib/utils';
import { AccountForm, type AccountFormData } from './accountForm';

interface AddAccountProps {
  refetchAccounts: () => void;
  charts: Chart[];
  clearRef: React.RefObject<HTMLButtonElement>;
  btnClassName?: string;
  initialValues?: Partial<AccountFormData>;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideButton?: boolean;
}

export const AddAccount: React.FC<AddAccountProps> = ({
  refetchAccounts,
  charts,
  clearRef,
  btnClassName,
  initialValues,
  isOpen,
  onOpenChange,
  hideButton = false,
}: AddAccountProps) => {
  const [openCreateForm, setOpenCreateForm] = useState(isOpen || false);
  const [accountHead, setAccountHead] = useState(
    initialValues?.headName ||
      toString(window.electron.store.get('createAccountHeadSelected')),
  );

  // sync external isOpen state with internal state
  useEffect(() => {
    if (isOpen !== undefined) {
      setOpenCreateForm(isOpen);
    }
  }, [isOpen]);

  const handleOpenChange = (open: boolean) => {
    setOpenCreateForm(open);
    onOpenChange?.(open);
  };

  const onSubmit = (values: AccountFormData) =>
    handleAsync(
      () =>
        window.electron.insertAccount({
          name: values.accountName,
          headName: values.headName,
          code: values.accountCode,
          address: values.address,
          phone1: values.phone1,
          phone2: values.phone2,
          goodsName: values.goodsName,
        }),
      {
        successMessage: `"${values.accountName}" account created successfully`,
        errorMessage: 'Failed to create account',
        onSuccess: () => {
          clearRef.current?.click();
          setOpenCreateForm(false);
          refetchAccounts();
        },
        getErrorMessage: (error) => {
          if (error.includes('UNIQUE')) {
            return 'Account name and code must be unique';
          }
          return 'An unexpected error occurred';
        },
      },
    );

  return (
    <Dialog open={openCreateForm} onOpenChange={handleOpenChange}>
      {!hideButton && (
        <DialogTrigger asChild>
          <Button
            variant="outline"
            className={cn('w-full min-w-max', btnClassName)}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Account
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Account</DialogTitle>
        </DialogHeader>
        <AccountForm
          onSubmit={onSubmit}
          charts={charts}
          clearRef={clearRef}
          initialValues={{ headName: accountHead, ...initialValues }}
          onHeadNameChange={(value) => {
            setAccountHead(value);
            window.electron.store.set('createAccountHeadSelected', value);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
