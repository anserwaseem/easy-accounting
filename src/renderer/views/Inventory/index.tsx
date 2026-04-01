import { convertFileToJson } from '@/renderer/lib/lib';
import { parseInventory } from '@/renderer/lib/parser';
import { Button } from '@/renderer/shad/ui/button';
import { Input } from '@/renderer/shad/ui/input';
import { toast } from '@/renderer/shad/ui/use-toast';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Label } from '@/renderer/shad/ui/label';
import { isNil, toString } from 'lodash';
import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { InventoryTable } from './inventoryTable';
import { AddInventoryItem } from './addInventoryItem';
import { SetOpeningStock } from './SetOpeningStock';
import { ManageItemTypes } from './ManageItemTypes';

const InventoryPage: React.FC = () => {
  const location = useLocation();
  const openManageItemTypesFromNav =
    (location.state as { openManageItemTypes?: boolean } | null)
      ?.openManageItemTypes === true;

  const [doesInventoryExist, setDoesInventoryExist] = useState<Boolean>();
  const [refresh, setRefresh] = useState(false);
  const [hideZeroQuantity, setHideZeroQuantity] = useState(true);
  const [hideZeroPrice, setHideZeroPrice] = useState(true);
  const [hideNegativeQuantity, setHideNegativeQuantity] = useState(true);
  const [hideNoType, setHideNoType] = useState(true);

  useEffect(() => {
    const checkInventoryExists = async () => {
      const result = await window.electron.doesInventoryExist();
      setDoesInventoryExist(result);
    };
    checkInventoryExists();
  }, []);

  const refetchInventory = () => setRefresh(!refresh);

  const uploadInventory = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    try {
      const json = await convertFileToJson(file);
      const inventory = parseInventory(json);
      const result = await window.electron.saveInventory(inventory);
      // eslint-disable-next-line no-console
      console.log('saveInventory result', result);
      refetchInventory();
      setDoesInventoryExist(result);
      toast({
        description: 'Inventory uploaded successfully.',
        variant: 'success',
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      toast({
        description: toString(error),
        variant: 'destructive',
      });
    }
  };

  if (isNil(doesInventoryExist)) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* page header: title + primary actions */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="title-new">Inventory</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              document.getElementById('uploadInventoryInput')?.click()
            }
          >
            <Upload size={16} className="mr-1.5" />
            Upload items
          </Button>
          <Input
            id="uploadInventoryInput"
            type="file"
            accept=".xlsx, .xls"
            className="hidden"
            onChange={uploadInventory}
          />
          <SetOpeningStock refetchInventory={refetchInventory} />
          <ManageItemTypes
            onUpdated={refetchInventory}
            initialOpen={openManageItemTypesFromNav}
          />
          <AddInventoryItem refetchInventory={refetchInventory} />
        </div>
      </header>

      {/* filters: single compact row */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-muted/30 px-4 py-3">
        <span className="text-sm font-medium text-muted-foreground">
          Hide items:
        </span>
        <Label
          htmlFor="filter-hide-all"
          className="flex cursor-pointer items-center gap-2 text-sm font-normal"
        >
          <Checkbox
            id="filter-hide-all"
            checked={
              hideNegativeQuantity &&
              hideZeroQuantity &&
              hideZeroPrice &&
              hideNoType
            }
            onCheckedChange={(checked) => {
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
          className="flex cursor-pointer items-center gap-2 text-sm font-normal"
        >
          <Checkbox
            id="filter-hide-negative-qty"
            checked={hideNegativeQuantity}
            onCheckedChange={(checked) =>
              setHideNegativeQuantity(checked === true)
            }
          />
          <span>Negative quantity</span>
        </Label>
        <Label
          htmlFor="filter-hide-zero-qty"
          className="flex cursor-pointer items-center gap-2 text-sm font-normal"
        >
          <Checkbox
            id="filter-hide-zero-qty"
            checked={hideZeroQuantity}
            onCheckedChange={(checked) => setHideZeroQuantity(checked === true)}
          />
          <span>Zero quantity</span>
        </Label>
        <Label
          htmlFor="filter-hide-zero-price"
          className="flex cursor-pointer items-center gap-2 text-sm font-normal"
        >
          <Checkbox
            id="filter-hide-zero-price"
            checked={hideZeroPrice}
            onCheckedChange={(checked) => setHideZeroPrice(checked === true)}
          />
          <span>Zero price</span>
        </Label>
        <Label
          htmlFor="filter-hide-no-type"
          className="flex cursor-pointer items-center gap-2 text-sm font-normal"
        >
          <Checkbox
            id="filter-hide-no-type"
            checked={hideNoType}
            onCheckedChange={(checked) => setHideNoType(checked === true)}
          />
          <span>No type</span>
        </Label>
      </div>

      <InventoryTable
        refetchInventory={refetchInventory}
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
