import { useCallback, useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/renderer/shad/ui/card';
import { Label } from '@/renderer/shad/ui/label';
import { Switch } from '@/renderer/shad/ui/switch';
import { ConfirmDialog } from '@/renderer/components/ConfirmDialog';
import { handleAsync } from '@/renderer/lib/utils';
import {
  ADVANCED_CAPABILITIES,
  ADVANCED_CAPABILITY_LABELS,
  ALL_ADVANCED_CAPABILITIES,
  type AdvancedCapability,
} from '@/core/advancedCapabilities';
import { useAdvancedCapabilities } from '@/renderer/hooks/useAdvancedCapabilities';

/**
 * The one place advanced controls can be switched on.
 *
 * Nothing is enabled by default, so a fresh install hides every advanced
 * control from the people using the machine. Each capability is listed
 * separately so the owner can unlock the harmless ones (editing a journal
 * note) without also unlocking the ones that rewrite the books.
 *
 * Turning a destructive one on asks for confirmation first, because the
 * actions it reveals (reversing a journal, deleting one, returning a posted
 * invoice, deleting an account) change the books and, for most of them,
 * cannot be undone.
 *
 * The setting is device-local: the shop's own machine can have it on while
 * the counter tablet stays clean. See src/core/advancedCapabilities.ts for
 * why it is a flag rather than a per-user role.
 */

/** Capabilities that destroy or rewrite records, so they ask first. */
const CONFIRM_ON_CAPABILITIES: readonly AdvancedCapability[] = [
  ADVANCED_CAPABILITIES.journalReverse,
  ADVANCED_CAPABILITIES.journalDelete,
  ADVANCED_CAPABILITIES.invoiceReturnSale,
  ADVANCED_CAPABILITIES.invoiceReturnPurchase,
  ADVANCED_CAPABILITIES.accountDelete,
  ADVANCED_CAPABILITIES.inventoryDelete,
  ADVANCED_CAPABILITIES.inventoryAdjustStock,
  ADVANCED_CAPABILITIES.vendorStockDelete,
];

const AdvancedControlsSettings: React.FC = () => {
  const { enabled, setEnabled, loaded } = useAdvancedCapabilities();
  const [pendingEnable, setPendingEnable] = useState<AdvancedCapability | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const isEnabled = useCallback(
    (capability: AdvancedCapability) => loaded && enabled.has(capability),
    [enabled, loaded],
  );

  const persist = useCallback(
    (next: Set<AdvancedCapability>, message: string) =>
      handleAsync(() => setEnabled([...next]), {
        successMessage: message,
        errorMessage: 'Could not change the advanced controls on this device',
        shouldExpectResult: false,
        onFinally: () => setBusy(false),
      }),
    [setEnabled],
  );

  const handleToggle = useCallback(
    (capability: AdvancedCapability, next: boolean) => {
      const updated = new Set(enabled);
      if (next) {
        if (CONFIRM_ON_CAPABILITIES.includes(capability)) {
          setPendingEnable(capability);
          return;
        }
        updated.add(capability);
      } else {
        updated.delete(capability);
      }
      setBusy(true);
      persist(
        updated,
        next
          ? `${ADVANCED_CAPABILITY_LABELS[capability]} is now available on this device`
          : `${ADVANCED_CAPABILITY_LABELS[capability]} is now hidden on this device`,
      );
    },
    [enabled, persist],
  );

  const handleConfirmEnable = useCallback(() => {
    if (!pendingEnable) return;
    const updated = new Set(enabled);
    updated.add(pendingEnable);
    setBusy(true);
    persist(
      updated,
      `${ADVANCED_CAPABILITY_LABELS[pendingEnable]} is now available on this device`,
    );
    setPendingEnable(null);
  }, [enabled, pendingEnable, persist]);

  const anyEnabled = loaded && enabled.size > 0;

  const allChecked = useMemo(
    () => ALL_ADVANCED_CAPABILITIES.every((c) => isEnabled(c)),
    [isEnabled],
  );

  const handleAllToggle = useCallback(
    (next: boolean) => {
      const updated = next
        ? new Set<AdvancedCapability>(ALL_ADVANCED_CAPABILITIES)
        : new Set<AdvancedCapability>();
      setBusy(true);
      persist(
        updated,
        next
          ? 'All advanced controls are now available on this device'
          : 'All advanced controls are now hidden on this device',
      );
    },
    [persist],
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Advanced controls</CardTitle>
          <CardDescription>
            Actions that change or remove existing records: reversing or
            deleting a journal, returning a posted invoice, deleting an account
            or inventory item, adjusting stock by hand. Off by default, and
            remembered on this device only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1 pr-4">
              <Label
                htmlFor="advancedControlsAll"
                className="cursor-pointer text-base font-medium"
              >
                Show all advanced controls
              </Label>
              <p className="text-sm text-muted-foreground">
                {anyEnabled
                  ? 'Some advanced controls are visible to whoever uses this device.'
                  : 'Only the everyday actions are visible on this device.'}
              </p>
            </div>
            <Switch
              id="advancedControlsAll"
              checked={allChecked}
              disabled={busy || !loaded}
              onCheckedChange={handleAllToggle}
            />
          </div>

          <div className="rounded-lg border">
            {ALL_ADVANCED_CAPABILITIES.map((capability, index) => (
              <div
                key={capability}
                className={`flex items-center justify-between gap-4 px-4 py-3 ${
                  index === 0 ? '' : 'border-t'
                }`}
              >
                <Label
                  htmlFor={`advancedCapability-${capability}`}
                  className="cursor-pointer text-sm font-normal"
                >
                  {ADVANCED_CAPABILITY_LABELS[capability]}
                </Label>
                <Switch
                  id={`advancedCapability-${capability}`}
                  checked={isEnabled(capability)}
                  disabled={busy || !loaded}
                  onCheckedChange={(next) => handleToggle(capability, next)}
                />
              </div>
            ))}
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              This hides controls from view; it is not a lock. Anyone who can
              change this device&apos;s stored settings can turn it back on.
            </span>
          </p>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={pendingEnable != null}
        onOpenChange={(open) => {
          if (!open) setPendingEnable(null);
        }}
        title="Turn on this advanced control?"
        description={
          pendingEnable
            ? `"${ADVANCED_CAPABILITY_LABELS[pendingEnable]}" will appear for everyone using this device. It changes or removes existing records, and several such actions cannot be undone.`
            : ''
        }
        confirmLabel="Turn on"
        confirmVariant="destructive"
        onConfirm={handleConfirmEnable}
      />
    </>
  );
};

export default AdvancedControlsSettings;
