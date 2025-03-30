import { PenBox, Copy } from 'lucide-react';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
  DialogFooter,
} from 'renderer/shad/ui/dialog';
import { Button } from 'renderer/shad/ui/button';
import { toast } from 'renderer/shad/ui/use-toast';
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
  });

  const onSubmit = async (values: AccountFormData) => {
    const res = await window.electron.updateAccount({
      id: values.id!,
      name: values.accountName,
      headName: values.headName,
      code: values.accountCode,
      address: values.address,
      phone1: values.phone1,
      phone2: values.phone2,
      goodsName: values.goodsName,
    });

    if (res) {
      refetchAccounts();
      toast({
        description: `"${values.accountName}" account updated successfully`,
        variant: 'success',
      });
      setIsOpen(false);
    } else {
      toast({
        description: `Failed to update "${values.accountName}" account`,
        variant: 'destructive',
      });
    }
  };

  const handleCreateCopy = () => {
    const formData = mapRowToFormData(row.original);
    const { id, ...copyData } = formData; // eslint-disable-line @typescript-eslint/no-unused-vars
    setAccountToCopy(copyData);
    setIsOpen(false);
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <PenBox size={16} cursor="pointer" className="py-0" />
        </DialogTrigger>
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
