import { InvoiceType } from 'types';
import { zodResolver } from '@hookform/resolvers/zod';
import { toNumber } from 'lodash';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { DEFAULT_INVOICE_NUMBER } from 'renderer/lib/constants';
import { Button } from 'renderer/shad/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from 'renderer/shad/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from 'renderer/shad/ui/form';
import { Input } from 'renderer/shad/ui/input';
import { useToast } from 'renderer/shad/ui/use-toast';
import { z } from 'zod';

interface AddInvoiceNumberProps {
  invoiceType: InvoiceType;
  onInvoiceNumberSet: (invoiceNumber: number) => void;
}

export const AddInvoiceNumber: React.FC<AddInvoiceNumberProps> = ({
  invoiceType,
  onInvoiceNumberSet,
}: AddInvoiceNumberProps) => {
  const { toast } = useToast();
  const [openCreateForm, setOpenCreateForm] = useState(false);

  const addFormSchema = z.object({
    invoiceNumber: z
      .number()
      .positive('Invoice number must be a positive integer'),
  });

  const defaultCreateValues = {
    invoiceNumber: DEFAULT_INVOICE_NUMBER,
  };

  const createForm = useForm<z.infer<typeof addFormSchema>>({
    resolver: zodResolver(addFormSchema),
    defaultValues: defaultCreateValues,
  });

  const onSubmit = async (values: z.infer<typeof addFormSchema>) => {
    try {
      onInvoiceNumberSet(values.invoiceNumber);

      setOpenCreateForm(false);
      toast({
        description: `Starting invoice number of ${invoiceType.toLowerCase()} set to ${
          values.invoiceNumber
        }`,
        variant: 'success',
      });
    } catch (error) {
      toast({
        description: `Failed to set starting invoice number of ${invoiceType.toLowerCase()}`,
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={openCreateForm} onOpenChange={setOpenCreateForm}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus size={16} />
          <span className="ml-3 mr-1">Set Starting Invoice Number</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Set Starting Invoice Number</DialogTitle>
        </DialogHeader>

        <Form {...createForm}>
          <form onSubmit={createForm.handleSubmit(onSubmit)}>
            <FormField
              control={createForm.control}
              name="invoiceNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{`Starting Invoice Number of ${invoiceType}`}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      min={1}
                      value={field.value}
                      onChange={(e) => field.onChange(toNumber(e.target.value))}
                      onBlur={(e) => field.onChange(toNumber(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-between mt-4">
              <Button type="submit" className="w-1/2">
                Set
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpenCreateForm(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
