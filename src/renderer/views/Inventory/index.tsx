import { convertFileToJson } from '@/renderer/lib/lib';
import { parseInventory } from '@/renderer/lib/parser';
import { Button } from '@/renderer/shad/ui/button';
import { Input } from '@/renderer/shad/ui/input';
import { useToast } from '@/renderer/shad/ui/use-toast';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { isNil, toString } from 'lodash';
import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { InventoryTable } from './inventoryTable';
import { AddInventoryItem } from './addInventoryItem';

const InventoryPage: React.FC = () => {
  const [doesInventoryExist, setDoesInventoryExist] = useState<Boolean>();
  const clearRef = useRef<HTMLButtonElement>(null);
  const [refresh, setRefresh] = useState(false);
  const [hideZeroQuantity, setHideZeroQuantity] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    (async () =>
      setDoesInventoryExist(await window.electron.doesInventoryExist()))();
  }, []);

  const refetchInventory = () => setRefresh(true);

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
        <AddInventoryItem
          refetchInventory={refetchInventory}
          clearRef={clearRef}
        />
      </div>
      <div className="flex flex-row gap-2 items-center">
        <h2 className="text-base">Hide zero quantity</h2>
        <Checkbox
          checked={hideZeroQuantity}
          onCheckedChange={(checked) => setHideZeroQuantity(checked === true)}
        />
      </div>
      <InventoryTable options={{ refresh, hideZeroQuantity }} />
    </div>
  );
};
export default InventoryPage;
