import { PenBox, Copy } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
  DialogFooter,
  DialogDescription,
} from 'renderer/shad/ui/dialog';
import { Button } from 'renderer/shad/ui/button';
import { toast } from 'renderer/shad/ui/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'renderer/shad/ui/dropdown-menu';
import type { UpdateAccount, Chart } from 'types';
import { useState } from 'react';
import { AccountForm, AccountFormData } from './accountForm';
import { AddAccount } from './addAccount';

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
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [accountToCopy, setAccountToCopy] = useState<AccountFormData | null>(
    null,
  );

  const mapRowToFormData = (inputRow: UpdateAccount): AccountFormData => ({
    id: inputRow.id,
    headName: inputRow.headName || '',
    accountName: inputRow.name || '',
    accountCode: inputRow.code === null ? undefined : inputRow.code,
    address: inputRow.address,
    phone1: inputRow.phone1,
    phone2: inputRow.phone2,
    goodsName: inputRow.goodsName,
    isActive: !!inputRow.isActive, // included for type safety, but not used in the form
  });

  const onSubmit = async (values: AccountFormData) => {
    const isUpdated: boolean = await window.electron.updateAccount({
      id: values.id!,
      name: values.accountName,
      headName: values.headName,
      code: values.accountCode,
      address: values.address,
      phone1: values.phone1,
      phone2: values.phone2,
      goodsName: values.goodsName,
      isActive: row.original.isActive,
    });

    toast({
      description: isUpdated
        ? `"${values.accountName}" account updated successfully`
        : `Failed to update "${values.accountName}" account`,
      variant: isUpdated ? 'success' : 'destructive',
    });

    if (isUpdated) {
      refetchAccounts();
      setIsOpen(false);
    }
  };

  const handleCreateCopy = () => {
    const formData = mapRowToFormData(row.original);
    const { id, ...copyData } = formData; // eslint-disable-line @typescript-eslint/no-unused-vars
    setAccountToCopy(copyData);
    setIsOpen(false);
  };

  const handleToggleActive = async () => {
    const hasJournals: boolean = await window.electron.hasJournalEntries(
      row.original.id,
    );

    // can toggle if: account is active and has journals (deactivate), or account is inactive (activate)
    const canToggle =
      (hasJournals && row.original.isActive) ||
      !row.original.isActive ||
      !hasJournals;

    if (!canToggle) return;

    const newActiveState = !row.original.isActive;
    const isUpdated: boolean = await window.electron.toggleAccountActive(
      row.original.id,
      newActiveState,
    );

    toast({
      description: isUpdated
        ? `Account "${row.original.name}" has been ${
            newActiveState ? 'activated' : 'deactivated'
          }`
        : `Failed to ${newActiveState ? 'activate' : 'deactivate'} account`,
      variant: isUpdated ? 'success' : 'destructive',
    });

    if (isUpdated) refetchAccounts();
  };

  const handleDeleteAccount = async () => {
    try {
      const hasJournals: boolean = await window.electron.hasJournalEntries(
        row.original.id,
      );

      if (hasJournals) {
        toast({
          description: `Cannot delete an account that has journal entries. ${
            row.original.isActive ? 'Please deactivate it instead.' : ''
          }`,
          variant: 'destructive',
        });
        return;
      }

      const isDeleted: boolean = await window.electron.deleteAccount(
        row.original.id,
      );

      toast({
        description: isDeleted
          ? `Account "${row.original.name}" has been deleted`
          : 'Failed to delete account',
        variant: isDeleted ? 'success' : 'destructive',
      });

      if (isDeleted) refetchAccounts();
    } catch (error) {
      toast({
        description: `Error deleting account: ${error}`,
        variant: 'destructive',
      });
    } finally {
      setIsDeleteDialogOpen(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <PenBox size={16} cursor="pointer" className="py-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setIsOpen(true)}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleToggleActive}>
            {row.original.isActive ? 'Deactivate' : 'Activate'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setIsDeleteDialogOpen(true)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Account</DialogTitle>
          </DialogHeader>
          <AccountForm
            onSubmit={onSubmit}
            charts={charts}
            clearRef={clearRef}
            initialValues={mapRowToFormData(row.original)}
          />
          <DialogFooter className="!justify-start">
            <Button
              variant="outline"
              onClick={handleCreateCopy}
              className="flex items-center"
            >
              <Copy className="mr-2 h-4 w-4" />
              Create a Copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{row.original.name}&quot;
              account? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteAccount}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {accountToCopy && (
        <AddAccount
          refetchAccounts={refetchAccounts}
          charts={charts}
          clearRef={clearRef}
          initialValues={accountToCopy}
          isOpen={!!accountToCopy}
          onOpenChange={(open: boolean) => {
            if (!open) setAccountToCopy(null);
          }}
          hideButton
        />
      )}
    </>
  );
};
