import type { FC } from 'react';
import type { BulkEditChangeSummary } from './inventoryBulkEdit';
import { formatListPosLabel } from './inventoryBulkEdit';

interface InventoryBulkEditSaveSummaryProps {
  summary: BulkEditChangeSummary;
  /** price list id -> name, so changes read as "Retail" not "List 1" */
  priceListNames?: Record<number, string>;
}

interface ChangeCellProps {
  from: string;
  to: string;
}

const ChangeCell: FC<ChangeCellProps> = ({ from, to }: ChangeCellProps) => (
  <span className="inline-flex flex-wrap items-baseline gap-x-1 tabular-nums">
    <span className="text-muted-foreground line-through decoration-muted-foreground/60">
      {from}
    </span>
    <span className="text-muted-foreground" aria-hidden="true">
      →
    </span>
    <span className="font-medium text-foreground">{to}</span>
  </span>
);

/** readable per-item change table for Save confirm — built only on Save click */
export const InventoryBulkEditSaveSummary: FC<
  InventoryBulkEditSaveSummaryProps
> = ({ summary, priceListNames }: InventoryBulkEditSaveSummaryProps) => {
  const {
    rows,
    truncatedCount,
    hasPriceChanges,
    hasListChanges,
    hasFamilyChanges,
    hasDescriptionChanges,
    hasDescriptionUrduChanges,
    hasPriceListChanges,
  } = summary;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 text-left">
      <p className="shrink-0 text-sm text-muted-foreground">
        These values will be written to inventory. Unchanged fields stay as they
        are.
      </p>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/95 text-left text-xs font-medium text-muted-foreground backdrop-blur">
            <tr>
              <th className="w-10 px-3 py-2 font-medium tabular-nums">#</th>
              <th className="px-3 py-2 font-medium">Item</th>
              {hasPriceChanges ? (
                <th className="px-3 py-2 font-medium">Price</th>
              ) : null}
              {hasPriceListChanges ? (
                <th className="px-3 py-2 font-medium">Price lists</th>
              ) : null}
              {hasListChanges ? (
                <th className="px-3 py-2 font-medium">List #</th>
              ) : null}
              {hasFamilyChanges ? (
                <th className="px-3 py-2 font-medium">Family</th>
              ) : null}
              {hasDescriptionChanges ? (
                <th className="px-3 py-2 font-medium">Description</th>
              ) : null}
              {hasDescriptionUrduChanges ? (
                <th className="px-3 py-2 font-medium">Description (Urdu)</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2 tabular-nums text-muted-foreground">
                  {index + 1}
                </td>
                <td className="max-w-[14rem] truncate px-3 py-2 font-medium text-foreground">
                  {row.name}
                </td>
                {hasPriceChanges ? (
                  <td className="px-3 py-2">
                    {row.priceFrom !== undefined &&
                    row.priceTo !== undefined ? (
                      <ChangeCell
                        from={String(row.priceFrom)}
                        to={String(row.priceTo)}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                ) : null}
                {hasPriceListChanges ? (
                  <td className="px-3 py-2">
                    {row.priceListChanges?.length ? (
                      <div className="flex flex-col gap-1">
                        {row.priceListChanges.map((change) => (
                          <div
                            key={change.priceListId}
                            className="flex items-center gap-2"
                          >
                            <span className="text-xs text-muted-foreground">
                              {priceListNames?.[change.priceListId] ??
                                `List ${change.priceListId}`}
                            </span>
                            <ChangeCell
                              from={
                                change.from == null ? '—' : String(change.from)
                              }
                              to={change.to == null ? '—' : String(change.to)}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                ) : null}
                {hasListChanges ? (
                  <td className="px-3 py-2">
                    {row.listTo !== undefined ? (
                      <ChangeCell
                        from={formatListPosLabel(row.listFrom ?? null)}
                        to={formatListPosLabel(row.listTo)}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                ) : null}
                {hasFamilyChanges ? (
                  <td className="px-3 py-2">
                    {row.familyFrom !== undefined &&
                    row.familyTo !== undefined ? (
                      <ChangeCell from={row.familyFrom} to={row.familyTo} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                ) : null}
                {hasDescriptionChanges ? (
                  <td className="max-w-[12rem] px-3 py-2">
                    {row.descriptionFrom !== undefined &&
                    row.descriptionTo !== undefined ? (
                      <ChangeCell
                        from={row.descriptionFrom}
                        to={row.descriptionTo}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                ) : null}
                {hasDescriptionUrduChanges ? (
                  <td className="max-w-[12rem] px-3 py-2" dir="rtl" lang="ur">
                    {row.descriptionUrduFrom !== undefined &&
                    row.descriptionUrduTo !== undefined ? (
                      <ChangeCell
                        from={row.descriptionUrduFrom}
                        to={row.descriptionUrduTo}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncatedCount > 0 ? (
        <p className="shrink-0 text-xs text-muted-foreground">
          …and {truncatedCount} more item{truncatedCount === 1 ? '' : 's'} not
          shown
        </p>
      ) : null}
    </div>
  );
};
