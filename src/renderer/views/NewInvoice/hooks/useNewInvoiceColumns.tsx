/* eslint-disable react/no-unstable-nested-components */
import { getFormattedCurrency } from 'renderer/lib/utils';
import {
  chargedUnitPrice,
  lineHasNetPrice,
  netRateOffer,
} from '@/lib/invoiceLineAmount';
import { toNumber, toString } from 'lodash';
import { X, Tags } from 'lucide-react';
import { useMemo, useState } from 'react';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from 'renderer/shad/ui/popover';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { InvoiceType } from 'types';
import type { ColumnDef } from 'renderer/shad/ui/dataTable';
import type { InvoiceItem, InventoryItem } from 'types';
import type { CustomerSection } from '../components/CustomerSectionsBlock';

interface PriceListOption {
  id: number;
  name: string;
  isActive?: number | boolean;
}

interface SalePriceCellProps<T extends FieldValues> {
  form: { control: Control<T>; getValues: (name?: string) => unknown };
  rowIndex: number;
  item: InventoryItem | undefined;
  onApplyNetRate: (rowIndex: number, netPrice: number) => void;
  onClearNetPrice: (rowIndex: number) => void;
}

/** charged unit in the price column. a net rate also shows the catalog price and the percent off it, on screen only. */
const SalePriceCell = <T extends FieldValues>({
  form,
  rowIndex,
  item,
  onApplyNetRate,
  onClearNetPrice,
}: SalePriceCellProps<T>) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [lists, setLists] = useState<PriceListOption[] | null>(null);
  const price = useWatch({
    control: form.control,
    name: `invoiceItems.${rowIndex}.price` as Path<T>,
  });
  const netPrice = useWatch({
    control: form.control,
    name: `invoiceItems.${rowIndex}.netPrice` as Path<T>,
  });
  const discount = useWatch({
    control: form.control,
    name: `invoiceItems.${rowIndex}.discount` as Path<T>,
  });
  const typedNet = typeof netPrice === 'number' ? netPrice : null;
  const offer = netRateOffer({
    price: typeof price === 'number' ? price : null,
    netPrice: typedNet,
    discount: typeof discount === 'number' ? discount : null,
  });
  const charged = chargedUnitPrice({
    price: typeof price === 'number' ? price : null,
    netPrice: typedNet,
  });

  const listChoices = (lists ?? []).flatMap((list) => {
    if (list.isActive === 0 || list.isActive === false) return [];
    const listPrice = item?.listPrices?.[list.id];
    if (listPrice == null || !(listPrice > 0)) return [];
    return [{ id: list.id, name: list.name, price: listPrice }];
  });

  return (
    <div className={`flex gap-1 ${offer ? 'items-start' : 'items-center'}`}>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="text-sm tabular-nums text-muted-foreground">
          {Number.isFinite(charged)
            ? getFormattedCurrency(toNumber(charged))
            : '—'}
        </span>
        {offer ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {offer.fullPrice.toFixed(2)} · {offer.discount}%
          </span>
        ) : null}
      </div>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next || lists) return;
          window.electron
            .getPriceLists()
            .then((rows) => setLists(rows))
            .catch((error: unknown) => {
              console.error('Error loading price lists', error);
              setLists([]);
            });
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 shrink-0 px-0"
            aria-label="Set a net rate"
            title="Set a net rate, or pick from a price list"
          >
            <Tags size={14} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-3">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium">Net rate</span>
            <Input
              aria-label="Net rate"
              className="h-8"
              type="number"
              min={0}
              step="any"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              className="h-8"
              onClick={() => {
                const net = toNumber(draft);
                if (!(net > 0)) return;
                onApplyNetRate(rowIndex, net);
                setOpen(false);
              }}
            >
              Apply net rate
            </Button>
            {listChoices.length > 0 ? (
              <div className="flex flex-col gap-1 border-t pt-2">
                {listChoices.map((choice) => (
                  <Button
                    key={choice.id}
                    type="button"
                    variant="ghost"
                    className="h-8 justify-between px-2 text-sm"
                    onClick={() => {
                      onApplyNetRate(rowIndex, choice.price);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{choice.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {choice.price}
                    </span>
                  </Button>
                ))}
              </div>
            ) : null}
            {lineHasNetPrice(typeof netPrice === 'number' ? netPrice : null) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => {
                  onClearNetPrice(rowIndex);
                  setOpen(false);
                }}
              >
                Use profile discount
              </Button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};

/** a net rate leaves the discount cell blank. the percent stays on the price cell, not here and not on the print. */
const SaleDiscountCell = <T extends FieldValues>({
  form,
  rowIndex,
  isDiscountEditEnabled,
  enableCumulativeDiscount,
  manualDiscountRows,
  getDiscountValue,
  onDiscountChange,
  onResetDiscountToAuto,
}: {
  form: { control: Control<T>; getValues: (name?: string) => unknown };
  rowIndex: number;
  isDiscountEditEnabled: boolean;
  enableCumulativeDiscount: boolean;
  manualDiscountRows: Record<number, boolean>;
  getDiscountValue: (fieldValue: number) => number;
  onDiscountChange: (
    rowIndex: number,
    value: string,
    onChange: (value: unknown) => void,
  ) => void;
  onResetDiscountToAuto: (rowIndex: number) => void;
}) => {
  const typedNet = useWatch({
    control: form.control,
    name: `invoiceItems.${rowIndex}.netPrice` as Path<T>,
  });
  if (lineHasNetPrice(typeof typedNet === 'number' ? typedNet : null)) {
    return null;
  }
  return (
    <FormField
      control={form.control}
      name={`invoiceItems.${rowIndex}.discount` as Path<T>}
      render={({ field }) => (
        <FormItem className="space-y-0">
          <FormControl>
            <div className="flex items-center gap-1.5">
              {!isDiscountEditEnabled || enableCumulativeDiscount ? (
                <p className="text-sm leading-tight text-muted-foreground tabular-nums">
                  {getDiscountValue(field.value as number)}%
                </p>
              ) : (
                <Input
                  className="my-0 h-8"
                  value={getDiscountValue(field.value as number)}
                  type="number"
                  step="any"
                  min={0}
                  max={100}
                  onBlur={(event) =>
                    field.onChange(toNumber(event.target.value))
                  }
                  onChange={(event) =>
                    onDiscountChange(
                      rowIndex,
                      event.target.value,
                      field.onChange,
                    )
                  }
                />
              )}
              {isDiscountEditEnabled &&
              manualDiscountRows[
                form.getValues(`invoiceItems.${rowIndex}.id`) as number
              ] ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => onResetDiscountToAuto(rowIndex)}
                >
                  Auto
                </Button>
              ) : null}
            </div>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
};

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
  onApplyNetRate: (rowIndex: number, netPrice: number) => void;
  onClearNetPrice: (rowIndex: number) => void;
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
              {availableQty !== undefined && (
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
    onApplyNetRate,
    onClearNetPrice,
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
          size: 120,
          minSize: 108,
          cell: ({ row }) => (
            <SalePriceCell<T>
              form={form}
              rowIndex={row.index}
              item={inventoryById.get(
                toNumber(
                  form.getValues(`invoiceItems.${row.index}.inventoryId`),
                ),
              )}
              onApplyNetRate={onApplyNetRate}
              onClearNetPrice={onClearNetPrice}
            />
          ),
        },
        {
          header: 'Disc',
          size: isDiscountEditEnabled ? 120 : 72,
          minSize: isDiscountEditEnabled ? 102 : 64,
          cell: ({ row }) => (
            <SaleDiscountCell<T>
              form={form}
              rowIndex={row.index}
              isDiscountEditEnabled={isDiscountEditEnabled}
              enableCumulativeDiscount={enableCumulativeDiscount}
              manualDiscountRows={manualDiscountRows}
              getDiscountValue={getDiscountValue}
              onDiscountChange={onDiscountChange}
              onResetDiscountToAuto={onResetDiscountToAuto}
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
    onApplyNetRate,
    onClearNetPrice,
    renderDiscountedPrice,
    onResetDiscountToAuto,
    applyAutoDiscountForRow,
    getSectionLabel,
    saleStockValidationBonusRef,
  ]);
}
