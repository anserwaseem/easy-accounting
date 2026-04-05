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

/** shorter select trigger + inputs in line-item rows (see Input default my-2) */
const compactLineSelectTrigger =
  'h-8 min-h-8 py-0 text-sm leading-tight [&>svg]:h-3.5 [&>svg]:w-3.5';

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
              <FormItem className="w-max min-w-[310px] space-y-0">
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
                  triggerClassName={compactLineSelectTrigger}
                  groupBy={(item) => item.itemTypeName?.trim() || 'Other'}
                  renderSelectItem={(item) => (
                    <div className="flex min-w-[260px] justify-between gap-2">
                      <span className="supports-[overflow-wrap:anywhere]:[overflow-wrap:anywhere] text-sm font-medium leading-snug">
                        {item.name}
                      </span>
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
                    className="my-0 h-8"
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
            size={14}
            className="shrink-0"
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
                    <p className="text-sm leading-tight text-muted-foreground tabular-nums">
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
                    <div className="flex items-center gap-1.5">
                      {!isDiscountEditEnabled || enableCumulativeDiscount ? (
                        <p className="text-sm leading-tight text-muted-foreground tabular-nums">
                          {getDiscountValue(field.value)}%
                        </p>
                      ) : (
                        <Input
                          {...field}
                          className="my-0 h-8"
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
                            className="h-7 shrink-0 px-2 text-xs"
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
                    <div className="text-sm leading-tight tabular-nums">
                      {renderDiscountedPrice(row.index, field.value as number)}
                    </div>
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
                  <div className="min-w-[150px] max-w-[200px]">
                    <VirtualSelect
                      options={sections.map((section, index) => ({
                        id: section.id,
                        name: getSectionLabel(section, index),
                      }))}
                      value={selectedSectionId}
                      triggerClassName={compactLineSelectTrigger}
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
                  const title = code ? `${label} (${code})` : label;
                  return (
                    <div
                      className="flex min-w-0 max-w-[13rem] items-center gap-1.5"
                      title={title}
                    >
                      <span className="min-w-0 truncate text-xs leading-tight text-muted-foreground">
                        {label}
                      </span>
                      {code ? (
                        <Badge
                          variant="secondary"
                          className="shrink-0 font-mono text-[10px] leading-none"
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
