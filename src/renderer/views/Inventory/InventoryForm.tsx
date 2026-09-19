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
import { Textarea } from 'renderer/shad/ui/textarea';
import { Label } from 'renderer/shad/ui/label';
import { Button } from 'renderer/shad/ui/button';
import { capitalize, get, keys, map, merge } from 'lodash';
import { baseEntityKeys } from '@/renderer/lib/constants';
import { useMemo, type ReactNode } from 'react';
import VirtualSelect from '@/renderer/components/VirtualSelect';

interface InventoryFormProps<
  T extends InsertInventoryItem | UpdateInventoryItem,
> {
  schema: z.ZodObject<z.ZodRawShape>;
  defaultValues: T;
  onSubmit: (values: T) => Promise<void>;
  onReset?: () => void;
  disabledFields?: string[];
  /**
   * Fields to leave out entirely, rather than show disabled.
   *
   * `disabledFields` is for a value the user may read but not change; this is
   * for one that does not apply to them at all, where a greyed-out box would
   * only raise a question. Used for the publish-only fields on an installation
   * that is not publishing.
   */
  hiddenFields?: string[];
  itemTypes?: ItemType[];
  showClear?: boolean;
  children?: ReactNode;
}

export const InventoryForm = <
  T extends InsertInventoryItem | UpdateInventoryItem,
>({
  schema,
  defaultValues,
  onSubmit,
  onReset,
  disabledFields = [],
  hiddenFields = [],
  itemTypes = [],
  showClear = true,
  children,
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

  const inventoryFieldLabel = (key: string): string => {
    if (key === 'itemTypeId') return 'Type';
    if (key === 'listPosition') return 'List #';
    // "title" alone reads as a synonym for the name field directly above it
    if (key === 'title') return 'Display title';
    if (key === 'descriptionUrdu') return 'Description (Urdu)';
    return capitalize(key);
  };

  const fields = map(
    schemaKeys.filter(
      (key) => !baseEntityKeyNames.includes(key) && !hiddenFields.includes(key),
    ),
    (key) => ({
      name: key as Path<T>,
      label: inventoryFieldLabel(key),
      type:
        key === 'listPosition' ||
        typeof defaultValues[key as keyof T] === 'number'
          ? 'number'
          : 'text',
    }),
  );

  const hasType = fields.some((f) => f.name === 'itemTypeId');
  const hasList = fields.some((f) => f.name === 'listPosition');

  const renderField = (name: Path<T>) => {
    const fieldItem = fields.find((f) => f.name === name);
    if (!fieldItem) return null;
    const { label, type } = fieldItem;
    const isTextArea =
      name === 'title' || name === 'description' || name === 'descriptionUrdu';
    const isUrdu = name === 'descriptionUrdu';

    return (
      <FormField
        key={name}
        control={form.control}
        name={name}
        disabled={disabledFields.includes(name)}
        render={({ field }) => {
          let inputControl: ReactNode;
          if (name === 'itemTypeId') {
            inputControl = (
              <VirtualSelect
                options={[{ id: 0, name: 'No type' }, ...itemTypes]}
                value={field.value as string | number | null | undefined}
                onChange={(value) => field.onChange(Number(value))}
                placeholder="Select item type"
                searchPlaceholder="Search item types..."
              />
            );
          } else if (isTextArea) {
            inputControl = (
              <Textarea
                {...field}
                rows={name === 'title' ? 2 : 3}
                dir={isUrdu ? 'rtl' : undefined}
                lang={isUrdu ? 'ur' : undefined}
                className={isUrdu ? 'text-right' : undefined}
                value={(field.value ?? '') as string}
              />
            );
          } else {
            inputControl = (
              <Input
                {...field}
                type={type}
                value={(field.value ?? '') as string | number}
              />
            );
          }

          return (
            <FormItem labelPosition="start">
              <FormLabel>{label}</FormLabel>
              <FormControl>{inputControl}</FormControl>
              <FormMessage />
            </FormItem>
          );
        }}
      />
    );
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        onReset={() => {
          onReset?.();
          form.reset(resetValues as T);
        }}
      >
        {renderField('name' as Path<T>)}
        {renderField('quantity' as Path<T>)}
        {renderField('price' as Path<T>)}

        {hasType && hasList ? (
          <div className="space-y-2 grid grid-cols-[1fr,2fr] items-center">
            <Label className="text-sm font-medium leading-none">Type</Label>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <FormField
                  control={form.control}
                  name={'itemTypeId' as Path<T>}
                  disabled={disabledFields.includes('itemTypeId')}
                  render={({ field }) => (
                    <FormItem className="space-y-0">
                      <FormControl>
                        <VirtualSelect
                          options={[{ id: 0, name: 'No type' }, ...itemTypes]}
                          value={
                            field.value as string | number | null | undefined
                          }
                          onChange={(value) => field.onChange(Number(value))}
                          placeholder="Select item type"
                          searchPlaceholder="Search item types..."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <span className="shrink-0 text-xs font-medium text-muted-foreground whitespace-nowrap">
                List #
              </span>
              <div className="w-28 shrink-0">
                <FormField
                  control={form.control}
                  name={'listPosition' as Path<T>}
                  disabled={disabledFields.includes('listPosition')}
                  render={({ field }) => (
                    <FormItem className="space-y-0">
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          placeholder="—"
                          className="text-center font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          value={(field.value ?? '') as string | number}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </div>
        ) : (
          <>
            {renderField('itemTypeId' as Path<T>)}
            {renderField('listPosition' as Path<T>)}
          </>
        )}

        {renderField('title' as Path<T>)}
        {renderField('description' as Path<T>)}
        {renderField('descriptionUrdu' as Path<T>)}

        {fields
          .filter(
            (f) =>
              ![
                'name',
                'quantity',
                'price',
                'itemTypeId',
                'listPosition',
                'title',
                'description',
                'descriptionUrdu',
              ].includes(f.name),
          )
          .map((f) => renderField(f.name))}

        {children}

        <div className="flex justify-between pt-2">
          <Button type="submit" className={showClear ? 'w-1/2' : 'w-full'}>
            Submit
          </Button>
          {showClear && (
            <Button type="reset" variant="ghost">
              Clear
            </Button>
          )}
        </div>
      </form>
    </Form>
  );
};
