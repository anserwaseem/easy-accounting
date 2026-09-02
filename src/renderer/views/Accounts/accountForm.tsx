import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useState } from 'react';
import { trim } from 'lodash';
import { Input } from 'renderer/shad/ui/input';
import { Button } from 'renderer/shad/ui/button';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from 'renderer/shad/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'renderer/shad/ui/select';
import type { Chart, CustomerGroup } from 'types';
import { ChartSelect } from 'renderer/components/ChartSelect';

// customer group select sentinels: shad Select values must be non-empty strings
const GROUP_NONE = 'none';
const GROUP_CREATE = '__create__';

export const accountFormSchema = z.object({
  id: z.number().optional(),
  headName: z.string().min(2).max(50),
  accountName: z.string().min(2).max(50),
  accountCode: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .nullable()
    .transform((val) => val ?? undefined),
  address: z
    .string()
    .optional()
    .nullable()
    .transform((val) => val ?? undefined),
  phone1: z
    .string()
    .optional()
    .nullable()
    .transform((val) => val ?? undefined),
  phone2: z
    .string()
    .optional()
    .nullable()
    .transform((val) => val ?? undefined),
  goodsName: z
    .string()
    .optional()
    .nullable()
    .transform((val) => val ?? undefined),
  isActive: z.boolean().default(true),
  // stored customer grouping ("025 migration"); null means ungrouped
  customerGroupId: z.number().nullable().optional(),
});

export type AccountFormData = z.infer<typeof accountFormSchema>;

export const defaultValues: AccountFormData = {
  headName: '',
  accountName: '',
  accountCode: undefined,
  address: undefined,
  phone1: undefined,
  phone2: undefined,
  goodsName: undefined,
  isActive: true,
  customerGroupId: null,
};

interface AccountFormProps {
  onSubmit: (values: AccountFormData) => Promise<void>;
  onReset?: () => void;
  initialValues?: Partial<AccountFormData>;
  charts: Chart[];
  clearRef?: React.RefObject<HTMLButtonElement>;
  onHeadNameChange?: (value: string) => void;
  /** when provided, renders the optional Customer Group selector */
  customerGroups?: CustomerGroup[];
  /** creates a group and returns it so the form can select it immediately */
  onCreateCustomerGroup?: (name: string) => Promise<CustomerGroup | undefined>;
}

export const AccountForm: React.FC<AccountFormProps> = ({
  onSubmit,
  onReset,
  initialValues,
  charts,
  clearRef,
  onHeadNameChange,
  customerGroups,
  onCreateCustomerGroup,
}: AccountFormProps) => {
  const form = useForm<AccountFormData>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: { ...defaultValues, ...initialValues },
  });

  // inline "create new group" mini-form, shown when the create option is picked
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const handleCreateGroup = async (
    onFieldChange: (value: number | null) => void,
  ) => {
    const name = trim(newGroupName);
    if (!name || !onCreateCustomerGroup) return;
    const created = await onCreateCustomerGroup(name);
    if (created) {
      onFieldChange(created.id);
      setIsCreatingGroup(false);
      setNewGroupName('');
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        onReset={() => {
          form.reset(defaultValues);
          onReset?.();
        }}
      >
        <FormField
          control={form.control}
          name="headName"
          render={({ field }) => (
            <FormItem labelPosition="start">
              <FormLabel>Account Head</FormLabel>
              <FormControl>
                <ChartSelect
                  charts={charts}
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    onHeadNameChange?.(value);
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
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
          control={form.control}
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
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem labelPosition="start">
              <FormLabel>Address</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone1"
          render={({ field }) => (
            <FormItem labelPosition="start">
              <FormLabel>Phone 1</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone2"
          render={({ field }) => (
            <FormItem labelPosition="start">
              <FormLabel>Phone 2</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="goodsName"
          render={({ field }) => (
            <FormItem labelPosition="start">
              <FormLabel>Goods Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {customerGroups && (
          <FormField
            control={form.control}
            name="customerGroupId"
            render={({ field }) => (
              <FormItem labelPosition="start">
                <FormLabel>Customer Group</FormLabel>
                <FormControl>
                  <div className="flex flex-col gap-2">
                    <Select
                      value={
                        field.value == null ? GROUP_NONE : String(field.value)
                      }
                      onValueChange={(value) => {
                        if (value === GROUP_CREATE) {
                          setIsCreatingGroup(true);
                          return;
                        }
                        setIsCreatingGroup(false);
                        field.onChange(
                          value === GROUP_NONE ? null : Number(value),
                        );
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={GROUP_NONE}>None</SelectItem>
                        {customerGroups.map((group) => (
                          <SelectItem key={group.id} value={String(group.id)}>
                            {group.name}
                          </SelectItem>
                        ))}
                        {onCreateCustomerGroup && (
                          <SelectItem value={GROUP_CREATE}>
                            Create new group…
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {isCreatingGroup && (
                      <div className="flex gap-2">
                        <Input
                          placeholder="New group name"
                          value={newGroupName}
                          onChange={(e) => setNewGroupName(e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={trim(newGroupName).length === 0}
                          onClick={() => handleCreateGroup(field.onChange)}
                        >
                          Add
                        </Button>
                      </div>
                    )}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="flex justify-between">
          <Button type="submit" className="w-1/2">
            Submit
          </Button>
          <Button type="reset" variant="ghost" ref={clearRef}>
            Clear
          </Button>
        </div>
      </form>
    </Form>
  );
};
