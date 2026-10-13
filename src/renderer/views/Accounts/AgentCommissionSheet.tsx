import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Plus, Save, Trash2 } from 'lucide-react';
import type {
  Account,
  AgentCommissionConfig,
  AgentCommissionSkuOverride,
  AgentCommissionTypeRate,
  Chart,
  InventoryItem,
  ItemType,
} from '@/types';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/renderer/shad/ui/sheet';
import { Button } from '@/renderer/shad/ui/button';
import { Input } from '@/renderer/shad/ui/input';
import { Label } from '@/renderer/shad/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/renderer/shad/ui/select';
import { toast } from '@/renderer/shad/ui/use-toast';
import VirtualSelect from '@/renderer/components/VirtualSelect';

interface AgentCommissionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialChartId?: number | null;
  charts: Chart[];
  accounts: Account[];
  onSaved?: (savedChartId?: number) => void;
}

export const AgentCommissionSheet: React.FC<AgentCommissionSheetProps> = ({
  open,
  onOpenChange,
  initialChartId,
  charts,
  accounts,
  onSaved,
}: AgentCommissionSheetProps) => {
  const navigate = useNavigate();

  // filter custom heads (agent heads have parentId != null)
  const agentHeads = useMemo(
    () =>
      charts
        .filter((chart) => chart.parentId != null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [charts],
  );

  const [selectedChartId, setSelectedChartId] = useState<number | null>(
    initialChartId ?? agentHeads[0]?.id ?? null,
  );
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [payableAccountId, setPayableAccountId] = useState<number | null>(null);
  const [expenseAccountId, setExpenseAccountId] = useState<number | null>(null);
  const [rates, setRates] = useState<
    Record<number, { normalPct: number; netPct: number }>
  >({});
  const [overrides, setOverrides] = useState<AgentCommissionSkuOverride[]>([]);
  const [newOverrideInventoryId, setNewOverrideInventoryId] = useState<
    number | null
  >(null);
  const [newOverrideRupees, setNewOverrideRupees] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // load item types & inventory on mount
  useEffect(() => {
    if (!open) return;
    let isCancelled = false;

    const loadPrerequisites = async () => {
      try {
        const [types, items] = await Promise.all([
          window.electron.getItemTypes(),
          window.electron.getInventory(),
        ]);
        if (!isCancelled) {
          setItemTypes(types.filter((t) => t.isActive));
          setInventory(items);
        }
      } catch (error) {
        console.error('Failed to load commission prerequisites:', error);
      }
    };

    loadPrerequisites();
    return () => {
      isCancelled = true;
    };
  }, [open]);

  // sync selectedChartId if initialChartId changes
  useEffect(() => {
    if (initialChartId != null) {
      setSelectedChartId(initialChartId);
    } else if (agentHeads.length > 0 && selectedChartId == null) {
      setSelectedChartId(agentHeads[0].id);
    }
  }, [initialChartId, agentHeads, selectedChartId]);

  // load config for selectedChartId
  const loadConfig = useCallback(
    async (chartId: number, currentItemTypes: ItemType[]) => {
      setIsLoading(true);
      try {
        const config = await window.electron.commissionGetConfig(chartId);
        setPayableAccountId(config?.payableAccountId ?? null);
        setExpenseAccountId(config?.expenseAccountId ?? null);

        const initialRates: Record<
          number,
          { normalPct: number; netPct: number }
        > = {};
        currentItemTypes.forEach((type) => {
          const match = config?.rates.find((r) => r.itemTypeId === type.id);
          initialRates[type.id] = {
            normalPct: match?.percent ?? match?.normalCommissionPct ?? 0,
            netPct: match?.netRatePercent ?? match?.netRateCommissionPct ?? 0,
          };
        });
        setRates(initialRates);
        setOverrides(config?.overrides ?? []);
      } catch (error) {
        console.error('Failed to load agent commission config:', error);
        toast({
          title: 'Error loading config',
          description:
            'Could not load commission configuration for this agent.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open || selectedChartId == null || itemTypes.length === 0) return;
    loadConfig(selectedChartId, itemTypes);
  }, [open, selectedChartId, itemTypes, loadConfig]);

  const handleRateChange = (
    itemTypeId: number,
    field: 'normalPct' | 'netPct',
    rawVal: string,
  ) => {
    const parsed = parseFloat(rawVal) || 0;
    setRates((prev) => ({
      ...prev,
      [itemTypeId]: {
        ...prev[itemTypeId],
        [field]: parsed,
      },
    }));
  };

  const handleAddOverride = () => {
    if (newOverrideInventoryId == null) {
      toast({
        title: 'Select Item',
        description: 'Please select an inventory item for the SKU override.',
        variant: 'destructive',
      });
      return;
    }
    const rupees = parseFloat(newOverrideRupees);
    if (Number.isNaN(rupees) || rupees < 0) {
      toast({
        title: 'Invalid amount',
        description: 'Please enter a valid rupee amount per unit.',
        variant: 'destructive',
      });
      return;
    }

    // replace existing or append
    setOverrides((prev) => {
      const filtered = prev.filter(
        (o) => o.inventoryId !== newOverrideInventoryId,
      );
      return [
        ...filtered,
        { inventoryId: newOverrideInventoryId, rupeesPerUnit: rupees },
      ];
    });

    setNewOverrideInventoryId(null);
    setNewOverrideRupees('');
  };

  const handleRemoveOverride = (inventoryId: number) => {
    setOverrides((prev) => prev.filter((o) => o.inventoryId !== inventoryId));
  };

  const handleSave = async () => {
    if (selectedChartId == null) return;
    setIsSaving(true);
    try {
      const typeRates: AgentCommissionTypeRate[] = Object.entries(rates).map(
        ([typeIdStr, rateVal]) => ({
          itemTypeId: Number(typeIdStr),
          percent: rateVal.normalPct,
          netRatePercent: rateVal.netPct,
          normalCommissionPct: rateVal.normalPct,
          netRateCommissionPct: rateVal.netPct,
        }),
      );

      const payload: AgentCommissionConfig = {
        chartId: selectedChartId,
        payableAccountId,
        expenseAccountId,
        rates: typeRates,
        overrides,
      };

      await window.electron.commissionSaveConfig(payload);
      toast({
        title: 'Settings saved',
        description:
          'Agent commission rates and linked accounts updated successfully.',
      });
      onSaved?.(selectedChartId);
    } catch (error) {
      console.error('Failed to save agent commission config:', error);
      toast({
        title: 'Save failed',
        description: 'Could not save commission settings.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenReport = () => {
    if (selectedChartId == null) return;
    onOpenChange(false);
    navigate(`/reports/agent-commission?chartId=${selectedChartId}`);
  };

  const inventoryNameMap = useMemo(() => {
    const map = new Map<number, string>();
    inventory.forEach((item) => {
      if (item.id != null) map.set(item.id, item.name);
    });
    return map;
  }, [inventory]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto max-h-screen">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle className="text-xl">Agent Commission Settings</SheetTitle>
          <SheetDescription>
            Configure item type rates, net-rate tiers, and fixed SKU overrides
            for sales agents.
          </SheetDescription>
        </SheetHeader>

        <div className="py-4 space-y-6">
          {/* Agent Picker */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Agent Head</Label>
            <Select
              value={selectedChartId ? String(selectedChartId) : undefined}
              onValueChange={(val) => setSelectedChartId(Number(val))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select an Agent head..." />
              </SelectTrigger>
              <SelectContent>
                {agentHeads.map((head) => (
                  <SelectItem key={head.id} value={String(head.id)}>
                    {head.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Linked Accounts for Settlements */}
          <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
            <h3 className="text-sm font-semibold text-foreground">
              Settlement Ledger Accounts
            </h3>
            <p className="text-xs text-muted-foreground">
              These accounts are credited and debited when commission is posted
              to the general ledger.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Agent Payable Account (Cr)
                </Label>
                <VirtualSelect
                  options={accounts}
                  value={payableAccountId}
                  onChange={(val) => setPayableAccountId(Number(val))}
                  placeholder="Select Agent Payable account..."
                  searchFields={['name', 'code', 'headName']}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Commission Expense Account (Dr)
                </Label>
                <VirtualSelect
                  options={accounts}
                  value={expenseAccountId}
                  onChange={(val) => setExpenseAccountId(Number(val))}
                  placeholder="Select Expense account..."
                  searchFields={['name', 'code', 'headName']}
                />
              </div>
            </div>
          </div>

          {/* Item Type Rates */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Item Type Rates (%)
              </h3>
              <p className="text-xs text-muted-foreground">
                Commission percentage applied to line totals. Net-rate % applies
                whenever an item has a custom net price.
              </p>
            </div>
            {isLoading && (
              <div className="text-xs text-muted-foreground py-4 text-center">
                Loading rates...
              </div>
            )}
            {!isLoading && itemTypes.length === 0 && (
              <div className="text-xs text-muted-foreground py-4 text-center">
                No active item types found.
              </div>
            )}
            {!isLoading && itemTypes.length > 0 && (
              <div className="border rounded-md divide-y overflow-hidden">
                <div className="grid grid-cols-12 bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground">
                  <div className="col-span-6">Item Type</div>
                  <div className="col-span-3 text-right">Normal Sale %</div>
                  <div className="col-span-3 text-right">Net-Rate Sale %</div>
                </div>
                {itemTypes.map((type) => {
                  const current = rates[type.id] ?? { normalPct: 0, netPct: 0 };
                  return (
                    <div
                      key={type.id}
                      className="grid grid-cols-12 px-3 py-2 items-center text-sm gap-2"
                    >
                      <div className="col-span-6 font-medium text-foreground">
                        {type.name}
                      </div>
                      <div className="col-span-3">
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          className="h-8 text-right text-xs"
                          value={current.normalPct}
                          onChange={(e) =>
                            handleRateChange(
                              type.id,
                              'normalPct',
                              e.target.value,
                            )
                          }
                        />
                      </div>
                      <div className="col-span-3">
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          className="h-8 text-right text-xs"
                          value={current.netPct}
                          onChange={(e) =>
                            handleRateChange(type.id, 'netPct', e.target.value)
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SKU Overrides */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                SKU Fixed Rupee Overrides
              </h3>
              <p className="text-xs text-muted-foreground">
                Fixed commission in Rs. per unit for specific items, overriding
                any percentage calculation.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 items-end border rounded-md p-3 bg-muted/20">
              <div className="flex-1 space-y-1">
                <Label className="text-xs font-medium">Inventory Item</Label>
                <VirtualSelect
                  options={inventory}
                  value={newOverrideInventoryId}
                  onChange={(val) => setNewOverrideInventoryId(Number(val))}
                  placeholder="Select item..."
                  searchFields={['name']}
                />
              </div>
              <div className="w-full sm:w-32 space-y-1">
                <Label className="text-xs font-medium">Rs. / Unit</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="0"
                  className="h-9 text-xs"
                  placeholder="e.g. 25"
                  value={newOverrideRupees}
                  onChange={(e) => setNewOverrideRupees(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="gap-1 h-9"
                onClick={handleAddOverride}
              >
                <Plus size={14} /> Add
              </Button>
            </div>

            {overrides.length > 0 && (
              <div className="border rounded-md divide-y overflow-hidden">
                <div className="grid grid-cols-12 bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground">
                  <div className="col-span-7">Item / SKU</div>
                  <div className="col-span-3 text-right">Fixed Rate</div>
                  <div className="col-span-2 text-right">Action</div>
                </div>
                {overrides.map((override) => (
                  <div
                    key={override.inventoryId}
                    className="grid grid-cols-12 px-3 py-2 items-center text-sm gap-2"
                  >
                    <div className="col-span-7 truncate font-medium text-foreground">
                      {inventoryNameMap.get(override.inventoryId) ??
                        `Item #${override.inventoryId}`}
                    </div>
                    <div className="col-span-3 text-right text-xs font-mono font-medium">
                      Rs. {override.rupeesPerUnit} / unit
                    </div>
                    <div className="col-span-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={() =>
                          handleRemoveOverride(override.inventoryId)
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="pt-4 border-t flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleOpenReport}
            disabled={selectedChartId == null}
          >
            <ExternalLink size={14} />
            Open Commission Report
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              className="gap-1.5"
              onClick={handleSave}
              disabled={isSaving || selectedChartId == null}
            >
              <Save size={14} />
              {isSaving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
