/* eslint-disable react/no-unstable-nested-components */
import { getFormattedCurrency } from 'renderer/lib/utils';
import { toNumber, toString } from 'lodash';
import { X } from 'lucide-react';
import { useMemo } from 'react';
import {
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from 'react-hook-form';
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

/** line-item row height; child input/button fill shell so empty + selected states match customer control proportions */
const compactLineSelectTrigger =
  'h-8 min-h-8 max-h-8 [&_input]:my-0 [&_input]:h-full [&_input]:min-h-0 [&_input]:border-0 [&_input]:py-0 [&_input]:text-sm [&_input]:leading-tight [&_button]:h-full [&_button]:min-h-0';

interface UseNewInvoiceColumnsParams<T extends FieldValues = FieldValues> {
  form: {
    control: Control<T>;
    getValues: (name?: string) => unknown;
  };
  inventory: InventoryItem[] | undefined;
  selectedInventoryCounts: Map<number, number>;
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
  /** Enter in quantity appends a line and focuses the new row item field */
  onQuantityEnterAddRow: (rowIndex: number) => void;
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
  /** sale edit: add back line qty already on invoice so displayed avail matches validation */
  saleStockValidationBonusRef?: React.MutableRefObject<Record<number, number>>;
}

/**
 * must watch inventoryId here: table data is useFieldArray `fields`, which does not reliably
 * mirror nested setValue updates, so row.original.inventoryId stays stale until append/remove.
 */
interface InvoiceLineQuantityCellProps<T extends FieldValues> {
  form: { control: Control<T> };
  rowIndex: number;
  inventoryById: Map<number, InventoryItem>;
  invoiceType: InvoiceType;
  saleStockValidationBonusRef?: React.MutableRefObject<Record<number, number>>;
  onQuantityChange: (
    rowIndex: number,
    value: string,
    onChange: (value: unknown) => void,
  ) => void;
  onQuantityEnterAddRow: (rowIndex: number) => void;
}

const InvoiceLineQuantityCell = <T extends FieldValues>({
  form,
  rowIndex,
  inventoryById,
  invoiceType,
  saleStockValidationBonusRef,
  onQuantityChange,
  onQuantityEnterAddRow,
}: InvoiceLineQuantityCellProps<T>) => {
  const inventoryIdWatched = useWatch({
    control: form.control,
    name: `invoiceItems.${rowIndex}.inventoryId` as Path<T>,
  });
  const invId = toNumber(inventoryIdWatched);
  const inv = inventoryById.get(invId);
  const bonus =
    invoiceType === InvoiceType.Sale
      ? saleStockValidationBonusRef?.current[invId] ?? 0
      : 0;
  const availableQty = inv && invId > 0 ? inv.quantity + bonus : undefined;
  let stockTitle = 'No item selected; stock not shown.';
  if (availableQty !== undefined) {
    stockTitle =
      invoiceType === InvoiceType.Sale
        ? `Available quantity: ${availableQty}.`
        : `On hand: ${availableQty}.`;
  }

  return (
    <FormField
      control={form.control}
      name={`invoiceItems.${rowIndex}.quantity` as Path<T>}
      render={({ field }) => (
        <FormItem className="space-y-0">
          <div className="flex h-8 min-h-8 max-h-8 w-full items-center gap-1.5">
            <FormControl className="m-0 flex min-w-0 flex-1">
              <Input
                {...field}
                className="my-0 h-8 w-full min-w-0"
                type="number"
                step={1}
                min={0}
                onBlur={(e) => field.onChange(toNumber(e.target.value))}
                onChange={(e) =>
                  onQuantityChange(rowIndex, e.target.value, field.onChange)
                }
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    !e.ctrlKey &&
                    !e.altKey &&
                    !e.metaKey
                  ) {
                    e.preventDefault();
                    onQuantityEnterAddRow(rowIndex);
                  }
                }}
              />
            </FormControl>

            <span
              className="flex shrink-0 items-center gap-1 tabular-nums leading-none"
              title={stockTitle}
            >
              {availableQty && (
                <>
                  <span className="text-xs font-extralight text-muted-foreground mb-0.5">
                    /
                  </span>
                  <span className="text-xs text-muted-foreground/70">
                    {availableQty}
                  </span>
                </>
              )}
            </span>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
};

export function useNewInvoiceColumns<T extends FieldValues>(
  params: UseNewInvoiceColumnsParams<T>,
): ColumnDef<InvoiceItem>[] {
  const {
    form,
    inventory,
    selectedInventoryCounts,
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
    onQuantityEnterAddRow,
    handleRemoveRow,
    getDiscountValue,
    onDiscountChange,
    renderDiscountedPrice,
    onResetDiscountToAuto,
    applyAutoDiscountForRow,
    getSectionLabel,
    saleStockValidationBonusRef,
  } = params;

  return useMemo(() => {
    const inventoryById = new Map<number, InventoryItem>();
    (inventory ?? []).forEach((item) => {
      inventoryById.set(item.id, item);
    });

    const getItemOptionsForRow = (rowIndex: number) => {
      const currentRow = form.getValues(`invoiceItems.${rowIndex}`) as
        | InvoiceItem
        | undefined;
      const currentInventoryId = toNumber(currentRow?.inventoryId);
      return (inventory ?? []).filter((item) => {
        const selectedCount = selectedInventoryCounts.get(item.id) ?? 0;
        return selectedCount === 0 || item.id === currentInventoryId;
      });
    };

    const baseColumns: ColumnDef<InvoiceItem>[] = [
      {
        id: 'lineNumber',
        header: '#',
        size: 30,
        cell: ({ row }) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {row.index + 1}
          </span>
        ),
      },
      {
        header: 'Item',
        size: 260,
        minSize: 200,
        cell: ({ row }) => (
          <FormField
            control={form.control}
            name={`invoiceItems.${row.index}.inventoryId` as Path<T>}
            render={({ field }) => (
              <FormItem className="w-full min-w-0 max-w-full space-y-0">
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
                  triggerRef={field.ref}
                  placeholder="Select item"
                  searchPlaceholder="Search items..."
                  triggerClassName={compactLineSelectTrigger}
                  groupBy={(item) => item.itemTypeName?.trim() || 'Other'}
                  renderTriggerValue={({ selected, placeholder: ph }) =>
                    selected ? (
                      <span className="flex w-full min-w-0 items-center gap-2 px-3 py-0 text-left text-sm font-normal">
                        <span className="min-w-0 flex-1 truncate">
                          {selected.name}
                        </span>
                        {selected.itemTypeName?.trim() ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {selected.itemTypeName.trim()}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="px-3 text-muted-foreground">{ph}</span>
                    )
                  }
                  renderSelectItem={(item) => (
                    <div className="flex min-w-[240px] justify-between gap-2">
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
        size: 140,
        minSize: 132,
        cell: ({ row }) => (
          <InvoiceLineQuantityCell<T>
            form={form}
            rowIndex={row.index}
            inventoryById={inventoryById}
            invoiceType={invoiceType}
            saleStockValidationBonusRef={saleStockValidationBonusRef}
            onQuantityChange={onQuantityChange}
            onQuantityEnterAddRow={onQuantityEnterAddRow}
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
          header: 'Disc',
          size: isDiscountEditEnabled ? 120 : 40,
          minSize: isDiscountEditEnabled ? 102 : 36,
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
          size: 112,
          minSize: 80,
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
    selectedInventoryCounts,
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
    onQuantityEnterAddRow,
    handleRemoveRow,
    getDiscountValue,
    onDiscountChange,
    renderDiscountedPrice,
    onResetDiscountToAuto,
    applyAutoDiscountForRow,
    getSectionLabel,
    saleStockValidationBonusRef,
  ]);
}
