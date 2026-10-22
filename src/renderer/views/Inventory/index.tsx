import { useCallback, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown, Settings2 } from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/shad/ui/dropdown-menu';
import {
  HideItemsMenu,
  type HideItemsOption,
} from '@/renderer/components/HideItemsMenu';
import { InventoryTable } from './inventoryTable';
import { AddInventoryItem } from './addInventoryItem';
import { ImportExportInventoryAttributes } from './ImportExportInventoryAttributes';
import { ManageItemTypes } from './ManageItemTypes';
import { ManagePriceLists } from './ManagePriceLists';
import { ManageAttributes } from './ManageAttributes';

const InventoryPage: React.FC = () => {
  const location = useLocation();
  const openManageItemTypesFromNav =
    (location.state as { openManageItemTypes?: boolean } | null)
      ?.openManageItemTypes === true;

  const [refresh, setRefresh] = useState(false);
  const [hideInactive, setHideInactive] = useState(true);
  const [hideZeroQuantity, setHideZeroQuantity] = useState(true);
  const [hideZeroPrice, setHideZeroPrice] = useState(true);
  const [hideNegativeQuantity, setHideNegativeQuantity] = useState(true);
  const [hideNoType, setHideNoType] = useState(true);
  const [bulkEditActive, setBulkEditActive] = useState(false);
  const [filteredIds, setFilteredIds] = useState<number[]>([]);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  // which "define the vocabulary" dialog is open; these are occasional setup
  // actions, so they live behind one menu instead of three header buttons
  const [manageDialog, setManageDialog] = useState<
    'itemTypes' | 'priceLists' | 'attributes' | null
  >(openManageItemTypesFromNav ? 'itemTypes' : null);

  // functional form: this is called from dialog callbacks, and two calls
  // from the same render would otherwise both write the same value —
  // the second refetch silently not happening
  const refetchInventory = () => setRefresh((previous) => !previous);

  const handleBulkEditActiveChange = useCallback((active: boolean) => {
    setBulkEditActive(active);
  }, []);

  const toolbarHostRef = useCallback((node: HTMLDivElement | null) => {
    setToolbarHost(node);
  }, []);

  const handleFilteredIdsChange = useCallback((ids: number[]) => {
    setFilteredIds(ids);
  }, []);

  // the hide filters, as the header menu shows them
  const hideOptions = useMemo<HideItemsOption[]>(
    () => [
      {
        id: 'inactive',
        label: 'Inactive',
        checked: hideInactive,
        onCheckedChange: setHideInactive,
      },
      {
        id: 'negative-quantity',
        label: 'Negative quantity',
        checked: hideNegativeQuantity,
        onCheckedChange: setHideNegativeQuantity,
      },
      {
        id: 'zero-quantity',
        label: 'Zero quantity',
        checked: hideZeroQuantity,
        onCheckedChange: setHideZeroQuantity,
      },
      {
        id: 'zero-price',
        label: 'Zero price',
        checked: hideZeroPrice,
        onCheckedChange: setHideZeroPrice,
      },
      {
        id: 'no-type',
        label: 'No type',
        checked: hideNoType,
        onCheckedChange: setHideNoType,
      },
    ],
    [
      hideInactive,
      hideNegativeQuantity,
      hideZeroQuantity,
      hideZeroPrice,
      hideNoType,
    ],
  );

  const allHideOptionsChecked =
    hideInactive &&
    hideNegativeQuantity &&
    hideZeroQuantity &&
    hideZeroPrice &&
    hideNoType;

  // "All" turns every filter on or off at once
  const handleAllHideOptionsChange = useCallback((checked: boolean) => {
    setHideInactive(checked);
    setHideNegativeQuantity(checked);
    setHideZeroQuantity(checked);
    setHideZeroPrice(checked);
    setHideNoType(checked);
  }, []);

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="title-new">Inventory</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* bulk-edit toolbar portals here — state stays in InventoryTable */}
          <div
            ref={toolbarHostRef}
            className="flex flex-wrap items-center gap-2"
          />
          {!bulkEditActive ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Settings2 size={16} />
                    Manage
                    <ChevronDown size={14} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => setManageDialog('itemTypes')}
                  >
                    Item types
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setManageDialog('priceLists')}
                  >
                    Price lists
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setManageDialog('attributes')}
                  >
                    Attributes
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <ImportExportInventoryAttributes
                    refetchInventory={refetchInventory}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
              <AddInventoryItem refetchInventory={refetchInventory} />
            </>
          ) : null}
          {/* The hide filters live behind the ⋮ in the header: as a strip
              of six checkboxes they were three ragged rows on a phone,
              more screen than the list they were filtering. */}
          <HideItemsMenu
            options={hideOptions}
            allChecked={allHideOptionsChecked}
            onAllCheckedChange={handleAllHideOptionsChange}
            disabled={bulkEditActive}
            className={bulkEditActive ? 'opacity-60' : undefined}
          />
        </div>
      </header>

      <ManageItemTypes
        onUpdated={refetchInventory}
        open={manageDialog === 'itemTypes'}
        onOpenChange={(next) => setManageDialog(next ? 'itemTypes' : null)}
      />
      <ManagePriceLists
        filteredInventoryIds={filteredIds}
        onUpdated={refetchInventory}
        open={manageDialog === 'priceLists'}
        onOpenChange={(next) => setManageDialog(next ? 'priceLists' : null)}
      />
      <ManageAttributes
        onUpdated={refetchInventory}
        open={manageDialog === 'attributes'}
        onOpenChange={(next) => setManageDialog(next ? 'attributes' : null)}
      />

      <InventoryTable
        refetchInventory={refetchInventory}
        toolbarHost={toolbarHost}
        onBulkEditActiveChange={handleBulkEditActiveChange}
        onFilteredIdsChange={handleFilteredIdsChange}
        options={{
          refresh,
          hideInactive,
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
