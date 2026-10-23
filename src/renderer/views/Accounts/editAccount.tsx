import { Ban, Copy, Pencil, Power, Trash2, MoreHorizontal } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
  DialogFooter,
  DialogDescription,
  DialogTrigger,
} from 'renderer/shad/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'renderer/shad/ui/dropdown-menu';
import { EditActionButton } from '@/renderer/components/EditActionButton';
import { AdvancedControl } from '@/renderer/components/AdvancedControl';
import { RowMenu } from '@/renderer/components/RowMenu';
import { ADVANCED_CAPABILITIES } from '@/core/advancedCapabilities';
import { Button } from 'renderer/shad/ui/button';
import { toast } from 'renderer/shad/ui/use-toast';
import { ipcErrorMessage } from '@/renderer/lib/ipcUserMessage';
import type { UpdateAccount, Chart } from 'types';
import { useState } from 'react';
import {
  AccountForm,
  type AccountFormData,
  toCollectionRole,
  toCollectionRoleOption,
} from './accountForm';
import { AddAccount } from './addAccount';

interface EditAccountProps {
  row: {
    original: UpdateAccount;
  };
  refetchAccounts: () => void;
  charts: Chart[];
  onEditPolicy?: () => void;
  /**
   * 'buttons' is the table: a pencil and a more-menu. 'menu' is the
   * card: one ⋮ that opens everything the row can do, edit included.
   */
  variant?: 'buttons' | 'menu';
}

export const EditAccount: React.FC<EditAccountProps> = ({
  row,
  refetchAccounts,
  charts,
  onEditPolicy,
  variant = 'buttons',
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
    addressUrdu: inputRow.addressUrdu,
    city: inputRow.city ?? undefined,
    cityUrdu: inputRow.cityUrdu ?? undefined,
    phone1: inputRow.phone1,
    phone2: inputRow.phone2,
    goodsName: inputRow.goodsName,
    nameUrdu: inputRow.nameUrdu,
    goodsNameUrdu: inputRow.goodsNameUrdu,
    isActive: !!inputRow.isActive, // included for type safety, but not used in the form
    tracksVendorStock: !!inputRow.tracksVendorStock,
    collectionRole: toCollectionRoleOption(inputRow.collectionRole),
    discountProfileId: inputRow.discountProfileId ?? null,
    discountProfileName: inputRow.discountProfileName ?? null,
  });

  const onSubmit = async (values: AccountFormData) => {
    let isUpdated: boolean;
    try {
      isUpdated = await window.electron.updateAccount({
        id: values.id!,
        name: values.accountName,
        headName: values.headName,
        code: values.accountCode,
        address: values.address,
        addressUrdu: values.addressUrdu,
        city: values.city,
        cityUrdu: values.cityUrdu,
        phone1: values.phone1,
        phone2: values.phone2,
        goodsName: values.goodsName,
        nameUrdu: values.nameUrdu,
        goodsNameUrdu: values.goodsNameUrdu,
        discountProfileId:
          values.discountProfileId ?? row.original.discountProfileId ?? null,
        isActive: row.original.isActive,
        tracksVendorStock: values.tracksVendorStock,
        collectionRole: toCollectionRole(values.collectionRole),
      });
    } catch (error) {
      // the guard refuses this when one of the advanced account fields is
      // changed while its control is off; the toast layer turns that into
      // a message the person can act on
      toast({
        description: ipcErrorMessage(error) || 'Failed to update account',
        variant: 'destructive',
      });
      return;
    }

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
      // the guard refuses this when "Delete an account" is off; the toast
      // layer turns that into a message the person can act on
      toast({
        description: ipcErrorMessage(error) || 'Error deleting account',
        variant: 'destructive',
      });
    } finally {
      setIsDeleteDialogOpen(false);
    }
  };

  const isActive = !!row.original.isActive;
  const toggleLabel = isActive ? 'Deactivate account' : 'Activate account';

  // the edit form, in a dialog of its own. It is mounted outside the
  // menu in both variants: a menu item that opens a dialog unmounts
  // the dialog with the menu when the dialog lives inside it.
  const editForm = (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader className="flex flex-row items-center justify-between space-y-0 pr-7">
        <DialogTitle>Edit Account</DialogTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCreateCopy}
          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          title="Create a copy of this account"
        >
          <Copy className="h-3.5 w-3.5" />
          Create a copy
        </Button>
      </DialogHeader>
      <AccountForm
        onSubmit={onSubmit}
        onCancel={() => setIsOpen(false)}
        onEditPolicy={
          onEditPolicy
            ? () => {
                setIsOpen(false);
                onEditPolicy();
              }
            : undefined
        }
        charts={charts}
        initialValues={mapRowToFormData(row.original)}
      />
    </DialogContent>
  );

  // the row's other actions, as menu items
  const moreItems = (
    <>
      <DropdownMenuItem onSelect={handleCreateCopy}>
        <Copy className="mr-2 h-4 w-4" />
        Create a copy
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <AdvancedControl capability={ADVANCED_CAPABILITIES.accountToggleActive}>
        <DropdownMenuItem onSelect={handleToggleActive}>
          {isActive ? (
            <Ban className="mr-2 h-4 w-4" />
          ) : (
            <Power className="mr-2 h-4 w-4" />
          )}
          {toggleLabel}
        </DropdownMenuItem>
      </AdvancedControl>
      <AdvancedControl capability={ADVANCED_CAPABILITIES.accountDelete}>
        <DropdownMenuItem
          onSelect={() => setIsDeleteDialogOpen(true)}
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete account
        </DropdownMenuItem>
      </AdvancedControl>
    </>
  );

  return (
    <>
      {variant === 'menu' ? (
        // the card: one control, and everything the row can do is in it
        <RowMenu label="Account actions">
          <DropdownMenuItem onSelect={() => setIsOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit account
          </DropdownMenuItem>
          {moreItems}
        </RowMenu>
      ) : (
        /* -ml-2 lines first glyph up with Actions header — same as inventory */
        <div className="-ml-2 flex items-center gap-0.5 whitespace-nowrap">
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <EditActionButton
                aria-label="Edit account"
                title="Edit account"
              />
            </DialogTrigger>
            {editForm}
          </Dialog>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0 md:h-8 md:w-8"
                title="More actions"
                aria-label="More actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {moreItems}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* the edit dialog, mounted on its own so a menu item can open it */}
      {variant === 'menu' ? (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          {editForm}
        </Dialog>
      ) : null}

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
