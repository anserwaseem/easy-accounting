/* eslint-disable react/no-unstable-nested-components */
import { getFormattedCurrency } from 'renderer/lib/utils';
import { toNumber, toString } from 'lodash';
import { X } from 'lucide-react';
import { useMemo } from 'react';
import type { Control, FieldValues, Path } from 'react-hook-form';
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from 'renderer/shad/ui/form';
import { Input } from 'renderer/shad/ui/input';
import { Button } from 'renderer/shad/ui/button';
import { Badge } from 'renderer/shad/ui/badge';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { InvoiceType } from 'types';
import type { ColumnDef } from 'renderer/shad/ui/dataTable';
import type { InvoiceItem, InventoryItem } from 'types';
import type { CustomerSection } from '../components/CustomerSectionsBlock';

interface UseNewInvoiceColumnsParams<T extends FieldValues = FieldValues> {
  form: {
    control: Control<T>;
    getValues: (name?: string) => unknown;
  };
  inventory: InventoryItem[] | undefined;
  invoiceType: InvoiceType;
  resolvedRowLabels: string[];
  resolvedRowCodes: string[];
  splitByItemType: boolean;
  useSingleAccount: boolean;
  enableCumulativeDiscount: boolean;
  isDiscountEditEnabled: boolean;
  manualDiscountRows: Record<number, boolean>;
  sections: CustomerSection[];
  rowSectionMap: Record<number, string>;
  setRowSectionMap: React.Dispatch<
    React.SetStateAction<Record<number, string>>
  >;
  onItemSelectionChange: (
    rowIndex: number,
    val: string,
    onChange: (value: unknown) => void,
  ) => void | Promise<void>;
  onQuantityChange: (
    rowIndex: number,
    value: string,
    onChange: (value: unknown) => void,
  ) => void;
  handleRemoveRow: (rowIndex: number) => void;
  getDiscountValue: (fieldValue: number) => number;
  onDiscountChange: (
    rowIndex: number,
    value: string,
    onChange: (value: unknown) => void,
  ) => void;
  renderDiscountedPrice: (
    rowIndex: number,
    fieldValue?: number,
  ) => React.ReactNode;
  onResetDiscountToAuto: (rowIndex: number) => void;
  applyAutoDiscountForRow: (
    rowIndex: number,
    inventoryId?: number,
    forcedAccountId?: number,
  ) => Promise<void>;
  getSectionLabel: (section: CustomerSection, index: number) => string;
}

export function useNewInvoiceColumns<T extends FieldValues>(
  params: UseNewInvoiceColumnsParams<T>,
): ColumnDef<InvoiceItem>[] {
  const {
    form,
    inventory,
    invoiceType,
    resolvedRowLabels,
    resolvedRowCodes,
    splitByItemType,
    useSingleAccount,
    enableCumulativeDiscount,
    isDiscountEditEnabled,
    manualDiscountRows,
    sections,
    rowSectionMap,
    setRowSectionMap,
    onItemSelectionChange,
    onQuantityChange,
    handleRemoveRow,
    getDiscountValue,
    onDiscountChange,
    renderDiscountedPrice,
    onResetDiscountToAuto,
    applyAutoDiscountForRow,
    getSectionLabel,
  } = params;

  return useMemo(() => {
    const getItemOptionsForRow = (rowIndex: number) => {
      const items = (form.getValues('invoiceItems') as InvoiceItem[]) || [];
      const selectedElsewhere = items
        .filter((item, idx) => idx !== rowIndex && item.inventoryId > 0)
        .map((item) => item.inventoryId);
      return (inventory || []).filter(
        (inv) => !selectedElsewhere.includes(inv.id),
      );
    };

    const baseColumns: ColumnDef<InvoiceItem>[] = [
      {
        header: 'Item',
        cell: ({ row }) => (
          <FormField
            control={form.control}
            name={`invoiceItems.${row.index}.inventoryId` as Path<T>}
            render={({ field }) => (
              <FormItem className="w-max min-w-[340px] space-y-0">
                <VirtualSelect<InventoryItem>
                  options={getItemOptionsForRow(row.index)}
                  value={field.value?.toString()}
                  onChange={(val) =>
                    onItemSelectionChange(
                      row.index,
                      toString(val),
                      field.onChange,
                    )
                  }
                  placeholder="Select item"
                  searchPlaceholder="Search items..."
                  groupBy={(item) => item.itemTypeName?.trim() || 'Other'}
                  renderSelectItem={(item) => (
                    <div className="flex min-w-[280px] justify-between gap-2">
                      <h2 className="supports-[overflow-wrap:anywhere]:[overflow-wrap:anywhere]">
                        {item.name}
                      </h2>
                      <div className="text-xs text-muted-foreground text-end">
                        <div className="flex gap-2">
                          <p className="font-bold">{item.quantity}</p>
                          <span className="font-extralight">
                            item{item.quantity < 2 ? '' : 's'} left
                          </span>
                        </div>
                        <p>{getFormattedCurrency(item.price)}</p>
                      </div>
                    </div>
                  )}
                />
                <FormMessage />
              </FormItem>
            )}
          />
        ),
      },
      {
        header: 'Quantity',
        size: 150,
        minSize: 120,
        cell: ({ row }) => (
          <FormField
            control={form.control}
            name={`invoiceItems.${row.index}.quantity` as Path<T>}
            render={({ field }) => (
              <FormItem className="space-y-0">
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    step={1}
                    min={0}
                    onBlur={(e) => field.onChange(toNumber(e.target.value))}
                    onChange={(e) =>
                      onQuantityChange(
                        row.index,
                        e.target.value,
                        field.onChange,
                      )
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ),
      },
      {
        id: 'remove',
        header: 'Action',
        size: 48,
        minSize: 40,
        cell: ({ row }) => (
          <X
            color="red"
            size={16}
            onClick={() => handleRemoveRow(row.index)}
            cursor="pointer"
          />
        ),
      },
    ];

    if (invoiceType === InvoiceType.Sale) {
      const priceColumns: ColumnDef<InvoiceItem>[] = [
        {
          header: 'Price',
          size: 100,
          minSize: 80,
          cell: ({ row }) => (
            <FormField
              control={form.control}
              name={`invoiceItems.${row.index}.price` as Path<T>}
              render={({ field }) => (
                <FormItem className="space-y-0">
                  <FormControl>
                    <p className="text-muted-foreground">
                      {typeof field.value === 'number' && field.value >= 0
                        ? getFormattedCurrency(toNumber(field.value))
                        : '—'}
                    </p>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ),
        },
        {
          header: 'Discount',
          size: isDiscountEditEnabled ? 150 : 75,
          minSize: isDiscountEditEnabled ? 135 : 60,
          cell: ({ row }) => (
            <FormField
              control={form.control}
              name={`invoiceItems.${row.index}.discount` as Path<T>}
              render={({ field }) => (
                <FormItem className="space-y-0">
                  <FormControl>
                    <div className="flex items-center gap-2">
                      {!isDiscountEditEnabled || enableCumulativeDiscount ? (
                        <p className="text-muted-foreground text-sm">
                          {getDiscountValue(field.value)}%
                        </p>
                      ) : (
                        <Input
                          {...field}
                          value={getDiscountValue(field.value)}
                          type="number"
                          step="any"
                          min={0}
                          max={100}
                          onBlur={(e) =>
                            field.onChange(toNumber(e.target.value))
                          }
                          onChange={(e) =>
                            onDiscountChange(
                              row.index,
                              e.target.value,
                              field.onChange,
                            )
                          }
                        />
                      )}
                      {isDiscountEditEnabled &&
                        manualDiscountRows[
                          form.getValues(
                            `invoiceItems.${row.index}.id`,
                          ) as number
                        ] && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onResetDiscountToAuto(row.index)}
                          >
                            Auto
                          </Button>
                        )}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ),
        },
        {
          header: 'Discounted Price',
          cell: ({ row }) => (
            <FormField
              control={form.control}
              name={`invoiceItems.${row.index}.discountedPrice` as Path<T>}
              render={({ field }) => (
                <FormItem className="space-y-0">
                  <FormControl>
                    <p>
                      {renderDiscountedPrice(row.index, field.value as number)}
                    </p>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ),
        },
      ];

      const sectionColumn: ColumnDef<InvoiceItem>[] = useSingleAccount
        ? []
        : [
            {
              header: 'Section *',
              cell: ({ row }) => {
                const rowId = form.getValues(
                  `invoiceItems.${row.index}.id`,
                ) as number;
                const selectedSectionId = rowSectionMap[rowId];
                return (
                  <div className="min-w-[180px]">
                    <VirtualSelect
                      options={sections.map((section, index) => ({
                        id: section.id,
                        name: getSectionLabel(section, index),
                      }))}
                      value={selectedSectionId}
                      onChange={async (sectionId) => {
                        const nextSectionId = toString(sectionId);
                        setRowSectionMap((prev) => ({
                          ...prev,
                          [rowId]: nextSectionId,
                        }));
                        const section = sections.find(
                          (entry) => entry.id === nextSectionId,
                        );
                        await applyAutoDiscountForRow(
                          row.index,
                          undefined,
                          toNumber(section?.accountId),
                        );
                      }}
                      placeholder="Select section"
                      searchPlaceholder="Search sections..."
                    />
                  </div>
                );
              },
            },
          ];

      const accountColumn: ColumnDef<InvoiceItem>[] =
        useSingleAccount && splitByItemType
          ? [
              {
                header: 'Account',
                cell: ({ row }) => {
                  const label = resolvedRowLabels[row.index] ?? '—';
                  const code = resolvedRowCodes[row.index]?.trim();
                  return (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {label}
                      </span>
                      {code ? (
                        <Badge
                          variant="secondary"
                          className="shrink-0 font-mono text-xs"
                        >
                          {code}
                        </Badge>
                      ) : null}
                    </div>
                  );
                },
              },
            ]
          : [];

      baseColumns.splice(baseColumns.length - 1, 0, ...priceColumns);
      baseColumns.splice(baseColumns.length - 1, 0, ...accountColumn);
      baseColumns.splice(baseColumns.length - 1, 0, ...sectionColumn);
    }

    return baseColumns;
  }, [
    form,
    inventory,
    invoiceType,
    resolvedRowLabels,
    resolvedRowCodes,
    splitByItemType,
    useSingleAccount,
    enableCumulativeDiscount,
    isDiscountEditEnabled,
    manualDiscountRows,
    sections,
    rowSectionMap,
    setRowSectionMap,
    onItemSelectionChange,
    onQuantityChange,
    handleRemoveRow,
    getDiscountValue,
    onDiscountChange,
    renderDiscountedPrice,
    onResetDiscountToAuto,
    applyAutoDiscountForRow,
    getSectionLabel,
  ]);
}
