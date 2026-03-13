import type { z } from 'zod';
import { DefaultValues, useForm, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type {
  InsertInventoryItem,
  UpdateInventoryItem,
  ItemType,
} from '@/types';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from 'renderer/shad/ui/form';
import { Input } from 'renderer/shad/ui/input';
import { Button } from 'renderer/shad/ui/button';
import { get, keys, map, merge } from 'lodash';
import { baseEntityKeys } from '@/renderer/lib/constants';
import { useMemo } from 'react';
import VirtualSelect from '@/renderer/components/VirtualSelect';

interface InventoryFormProps<
  T extends InsertInventoryItem | UpdateInventoryItem,
> {
  schema: z.ZodObject<z.ZodRawShape>;
  defaultValues: T;
  onSubmit: (values: T) => Promise<void>;
  onReset?: () => void;
  disabledFields?: string[];
  itemTypes?: ItemType[];
}

export const InventoryForm = <
  T extends InsertInventoryItem | UpdateInventoryItem,
>({
  schema,
  defaultValues,
  onSubmit,
  onReset,
  disabledFields = [],
  itemTypes = [],
}: InventoryFormProps<T>) => {
  const form = useForm<T>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues as DefaultValues<T>,
  });

  const resetValues = useMemo(
    () =>
      merge(
        {},
        defaultValues,
        {
          quantity: 0,
          price: 0,
          description: '', // undefined, // not able to reset description. See https://github.com/orgs/react-hook-form/discussions/5858#discussioncomment-11150749
        },
        { name: get(defaultValues, 'id') ? defaultValues.name : '' },
      ),
    [defaultValues],
  );

  const schemaKeys = keys(schema.shape);
  const baseEntityKeyNames = baseEntityKeys.map((key) => String(key));

  const fields = map(
    schemaKeys.filter((key) => !baseEntityKeyNames.includes(key)),
    (key) => ({
      name: key as Path<T>,
      label: key === 'itemTypeId' ? 'Type' : key,
      type:
        typeof defaultValues[key as keyof T] === 'number' ? 'number' : 'text',
    }),
  );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        onReset={() => {
          onReset?.();
          form.reset(resetValues as T);
        }}
      >
        {fields.map(({ name, label, type }) => (
          <FormField
            key={name}
            control={form.control}
            name={name}
            disabled={disabledFields.includes(name)}
            render={({ field }) => (
              <FormItem labelPosition="start">
                <FormLabel>{label}</FormLabel>
                <FormControl>
                  {name === 'itemTypeId' ? (
                    <VirtualSelect
                      options={[{ id: 0, name: 'No type' }, ...itemTypes]}
                      value={field.value as string | number | null | undefined}
                      onChange={(value) => field.onChange(Number(value))}
                      placeholder="Select item type"
                      searchPlaceholder="Search item types..."
                    />
                  ) : (
                    <Input
                      {...field}
                      type={type}
                      value={(field.value ?? '') as string | number}
                    />
                  )}
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
        <div className="flex justify-between">
          <Button type="submit" className="w-1/2">
            Submit
          </Button>
          <Button type="reset" variant="ghost">
            Clear
          </Button>
        </div>
      </form>
    </Form>
  );
};
