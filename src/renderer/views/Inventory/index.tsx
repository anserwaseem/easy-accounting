import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Label } from '@/renderer/shad/ui/label';
import { InventoryTable } from './inventoryTable';
import { AddInventoryItem } from './addInventoryItem';
import { ManageItemTypes } from './ManageItemTypes';
import { ImportListNumbers } from './ImportListNumbers';

const InventoryPage: React.FC = () => {
  const location = useLocation();
  const openManageItemTypesFromNav =
    (location.state as { openManageItemTypes?: boolean } | null)
      ?.openManageItemTypes === true;

  const [refresh, setRefresh] = useState(false);
  const [hideZeroQuantity, setHideZeroQuantity] = useState(true);
  const [hideZeroPrice, setHideZeroPrice] = useState(true);
  const [hideNegativeQuantity, setHideNegativeQuantity] = useState(true);
  const [hideNoType, setHideNoType] = useState(true);
  const [bulkEditActive, setBulkEditActive] = useState(false);

  const refetchInventory = () => setRefresh(!refresh);

  const handleBulkEditActiveChange = useCallback((active: boolean) => {
    setBulkEditActive(active);
  }, []);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="title-new">Inventory</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ImportListNumbers refetchInventory={refetchInventory} />
          <ManageItemTypes
            onUpdated={refetchInventory}
            initialOpen={openManageItemTypesFromNav}
          />
          <AddInventoryItem refetchInventory={refetchInventory} />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-muted/30 px-4 py-3">
        <span className="text-sm font-medium text-muted-foreground">
          Hide items:
        </span>
        <Label
          htmlFor="filter-hide-all"
          className={`flex items-center gap-2 text-sm font-normal ${
            bulkEditActive ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
          }`}
        >
          <Checkbox
            id="filter-hide-all"
            disabled={bulkEditActive}
            checked={
              hideNegativeQuantity &&
              hideZeroQuantity &&
              hideZeroPrice &&
              hideNoType
            }
            onCheckedChange={(checked) => {
              if (bulkEditActive) return;
              const value = checked === true;
              setHideNegativeQuantity(value);
              setHideZeroQuantity(value);
              setHideZeroPrice(value);
              setHideNoType(value);
            }}
          />
          <span>All</span>
        </Label>
        <Label
          htmlFor="filter-hide-negative-qty"
          className={`flex items-center gap-2 text-sm font-normal ${
            bulkEditActive ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
          }`}
        >
          <Checkbox
            id="filter-hide-negative-qty"
            disabled={bulkEditActive}
            checked={hideNegativeQuantity}
            onCheckedChange={(checked) => {
              if (bulkEditActive) return;
              setHideNegativeQuantity(checked === true);
            }}
          />
          <span>Negative quantity</span>
        </Label>
        <Label
          htmlFor="filter-hide-zero-qty"
          className={`flex items-center gap-2 text-sm font-normal ${
            bulkEditActive ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
          }`}
        >
          <Checkbox
            id="filter-hide-zero-qty"
            disabled={bulkEditActive}
            checked={hideZeroQuantity}
            onCheckedChange={(checked) => {
              if (bulkEditActive) return;
              setHideZeroQuantity(checked === true);
            }}
          />
          <span>Zero quantity</span>
        </Label>
        <Label
          htmlFor="filter-hide-zero-price"
          className={`flex items-center gap-2 text-sm font-normal ${
            bulkEditActive ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
          }`}
        >
          <Checkbox
            id="filter-hide-zero-price"
            disabled={bulkEditActive}
            checked={hideZeroPrice}
            onCheckedChange={(checked) => {
              if (bulkEditActive) return;
              setHideZeroPrice(checked === true);
            }}
          />
          <span>Zero price</span>
        </Label>
        <Label
          htmlFor="filter-hide-no-type"
          className={`flex items-center gap-2 text-sm font-normal ${
            bulkEditActive ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
          }`}
        >
          <Checkbox
            id="filter-hide-no-type"
            disabled={bulkEditActive}
            checked={hideNoType}
            onCheckedChange={(checked) => {
              if (bulkEditActive) return;
              setHideNoType(checked === true);
            }}
          />
          <span>No type</span>
        </Label>
        {bulkEditActive ? (
          <span className="text-xs text-muted-foreground">
            Filters locked while editing prices
          </span>
        ) : null}
      </div>

      <InventoryTable
        refetchInventory={refetchInventory}
        onBulkEditActiveChange={handleBulkEditActiveChange}
        options={{
          refresh,
          hideZeroQuantity,
          hideZeroPrice,
          hideNegativeQuantity,
          hideNoType,
        }}
      />
    </div>
  );
};
export default InventoryPage;
