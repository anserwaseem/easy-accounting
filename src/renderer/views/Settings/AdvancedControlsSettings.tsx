import { useCallback, useMemo, useState } from 'react';
import { ShieldAlert, TriangleAlert } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/renderer/shad/ui/card';
import { Label } from '@/renderer/shad/ui/label';
import { Switch } from '@/renderer/shad/ui/switch';
import { Input } from '@/renderer/shad/ui/input';
import { ConfirmDialog } from '@/renderer/components/ConfirmDialog';
import { handleAsync } from '@/renderer/lib/utils';
import {
  ADVANCED_CAPABILITY_GROUPS,
  ADVANCED_CAPABILITY_LABELS,
  ALL_ADVANCED_CAPABILITIES,
  DESTRUCTIVE_ADVANCED_CAPABILITIES,
  type AdvancedCapability,
  type AdvancedCapabilityGroup,
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
 * cannot be undone. The master switch asks the same question, because
 * turning it on enables every one of them at once.
 *
 * The setting is device-local: the shop's own machine can have it on while
 * the counter tablet stays clean. See src/core/advancedCapabilities.ts for
 * why it is a flag rather than a per-user role.
 */

/** a group with the capabilities that match the search, if any */
interface VisibleGroup extends AdvancedCapabilityGroup {
  capabilities: AdvancedCapability[];
}

const AdvancedControlsSettings: React.FC = () => {
  const { enabled, setEnabled, loaded } = useAdvancedCapabilities();
  const [pendingEnable, setPendingEnable] = useState<AdvancedCapability | null>(
    null,
  );
  const [pendingEnableAll, setPendingEnableAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

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
        if (DESTRUCTIVE_ADVANCED_CAPABILITIES.includes(capability)) {
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
      // turning everything on is the same decision as turning on every
      // destructive control at once, so it asks the same question
      if (next) {
        setPendingEnableAll(true);
        return;
      }
      setBusy(true);
      persist(
        new Set<AdvancedCapability>(),
        'All advanced controls are now hidden on this device',
      );
    },
    [persist],
  );

  const handleConfirmEnableAll = useCallback(() => {
    setBusy(true);
    persist(
      new Set<AdvancedCapability>(ALL_ADVANCED_CAPABILITIES),
      'All advanced controls are now available on this device',
    );
    setPendingEnableAll(false);
  }, [persist]);

  /**
   * The groups, with the search applied.
   *
   * The search matches the label the owner reads, not the capability id:
   * someone looking for "return" wants the invoice returns, and typing
   * "invoice.returnSale" is not something they would think to do.
   */
  const visibleGroups = useMemo<VisibleGroup[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return ADVANCED_CAPABILITY_GROUPS.map((group) => ({
        ...group,
        capabilities: [...group.capabilities],
      }));
    }
    return ADVANCED_CAPABILITY_GROUPS.map((group) => ({
      ...group,
      capabilities: group.capabilities.filter((capability) =>
        ADVANCED_CAPABILITY_LABELS[capability].toLowerCase().includes(needle),
      ),
    })).filter((group) => group.capabilities.length > 0);
  }, [query]);

  const destructiveCount = useMemo(
    () => DESTRUCTIVE_ADVANCED_CAPABILITIES.length,
    [],
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Advanced controls</CardTitle>
          <CardDescription>
            Actions that change or remove existing records: reversing or
            deleting a journal, returning a posted invoice, deleting an account
            or inventory item, adjusting stock by hand, restating opening stock.
            Also the reports the owner may not want on every device. Off by
            default, and remembered on this device only.
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

          <div className="flex items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the controls"
              aria-label="Search the advanced controls"
              className="h-11 md:h-9"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                Clear
              </button>
            ) : null}
          </div>

          {visibleGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No advanced control matches &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : null}

          {visibleGroups.map((group) => (
            <div key={group.id} className="rounded-lg border">
              <div className="border-b px-4 py-3">
                <p className="text-sm font-medium">{group.title}</p>
                <p className="text-xs text-muted-foreground">
                  {group.description}
                </p>
              </div>
              {group.capabilities.map((capability, index) => (
                <div
                  key={capability}
                  className={`flex items-center justify-between gap-4 px-4 py-3 ${
                    index === 0 ? '' : 'border-t'
                  }`}
                >
                  <div className="flex items-center gap-2 pr-2">
                    <Label
                      htmlFor={`advancedCapability-${capability}`}
                      className="cursor-pointer text-sm font-normal"
                    >
                      {ADVANCED_CAPABILITY_LABELS[capability]}
                    </Label>
                    {DESTRUCTIVE_ADVANCED_CAPABILITIES.includes(capability) ? (
                      <span
                        className="flex items-center gap-1 text-xs text-destructive"
                        title="Changes or removes records, and may not be undoable"
                      >
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                        Changes records
                      </span>
                    ) : null}
                  </div>
                  <Switch
                    id={`advancedCapability-${capability}`}
                    checked={isEnabled(capability)}
                    disabled={busy || !loaded}
                    onCheckedChange={(next) => handleToggle(capability, next)}
                  />
                </div>
              ))}
            </div>
          ))}

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              This hides controls from view; it is not a lock. Anyone who can
              change this device&apos;s stored settings can turn it back on.
              {destructiveCount > 0
                ? ` ${destructiveCount} of these change or remove records, and most cannot be undone.`
                : ''}
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

      <ConfirmDialog
        open={pendingEnableAll}
        onOpenChange={(open) => {
          if (!open) setPendingEnableAll(false);
        }}
        title="Show all advanced controls?"
        description="Every advanced control will appear for everyone using this device, including the ones that delete records, reverse journals, and return posted invoices. Several of those actions cannot be undone. Turn on only the ones you need instead if you are unsure."
        confirmLabel="Show all"
        confirmVariant="destructive"
        onConfirm={handleConfirmEnableAll}
      />
    </>
  );
};

export default AdvancedControlsSettings;
