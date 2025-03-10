import { convertFileToJson } from '@/renderer/lib/lib';
import { parseInventory } from '@/renderer/lib/parser';
import { Button } from '@/renderer/shad/ui/button';
import { Input } from '@/renderer/shad/ui/input';
import { toast } from '@/renderer/shad/ui/use-toast';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { isNil, toString } from 'lodash';
import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import { InventoryTable } from './inventoryTable';
import { AddInventoryItem } from './addInventoryItem';

const InventoryPage: React.FC = () => {
  const [doesInventoryExist, setDoesInventoryExist] = useState<Boolean>();
  const [refresh, setRefresh] = useState(false);
  const [hideZeroQuantity, setHideZeroQuantity] = useState(false);
  const [hideZeroPrice, setHideZeroPrice] = useState(false);
  const [hideNegativeQuantity, setHideNegativeQuantity] = useState(false);
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
    <div>
      <div className="flex justify-between items-center py-4 pr-4">
        <div className="flex max-w-sm items-center">
          <Button
            variant="outline"
            className="w-fit"
            onClick={() =>
              document.getElementById('uploadInventoryInput')?.click()
            }
          >
            <Upload size={16} />
            <span className="ml-3 mr-1">Upload Inventory</span>
          </Button>
          <Input
            id="uploadInventoryInput"
            type="file"
            accept=".xlsx, .xls"
            className="hidden"
            onChange={uploadInventory}
          />
        </div>
        <h1 className="text-2xl text-center mx-auto">Inventory</h1>
        <AddInventoryItem refetchInventory={refetchInventory} />
      </div>
      <div className="flex flex-row gap-2 items-center">
        <h2 className="text-base">Hide negative quantity</h2>
        <Checkbox
          checked={hideNegativeQuantity}
          onCheckedChange={(checked) =>
            setHideNegativeQuantity(checked === true)
          }
        />
      </div>
      <div className="flex flex-row gap-2 items-center">
        <h2 className="text-base">Hide zero quantity</h2>
        <Checkbox
          checked={hideZeroQuantity}
          onCheckedChange={(checked) => setHideZeroQuantity(checked === true)}
        />
      </div>
      <div className="flex flex-row gap-2 items-center">
        <h2 className="text-base">Hide zero price</h2>
        <Checkbox
          checked={hideZeroPrice}
          onCheckedChange={(checked) => setHideZeroPrice(checked === true)}
        />
      </div>
      <InventoryTable
        refetchInventory={refetchInventory}
        options={{
          refresh,
          hideZeroQuantity,
          hideZeroPrice,
          hideNegativeQuantity,
        }}
      />
    </div>
  );
};
export default InventoryPage;
