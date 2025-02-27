import { PenBox } from 'lucide-react';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from 'renderer/shad/ui/dialog';
import { toast } from 'renderer/shad/ui/use-toast';
import type { UpdateAccount, Chart } from 'types';
import { AccountForm, AccountFormData } from './accountForm';

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
  const mapRowToFormData = (inputRow: UpdateAccount): AccountFormData => ({
    id: inputRow.id,
    headName: inputRow.headName || '',
    accountName: inputRow.name || '',
    accountCode: inputRow.code,
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
    } else {
      toast({
        description: `Failed to update "${values.accountName}" account`,
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog>
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
      </DialogContent>
    </Dialog>
  );
};
