import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link2, Plus, Unlink2 } from 'lucide-react';
import { toNumber } from 'lodash';
import type { Account, DiscountProfile, ItemType } from 'types';
import { Button } from '@/renderer/shad/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/renderer/shad/ui/card';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { Input } from '@/renderer/shad/ui/input';
import { Separator } from '@/renderer/shad/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/renderer/shad/ui/sheet';
import { toast } from '@/renderer/shad/ui/use-toast';
import VirtualSelect from '@/renderer/components/VirtualSelect';
import { getFixedNumber } from '@/renderer/lib/utils';

interface AccountPricingSheetProps {
  open: boolean;
  account?: Account;
  discountProfiles: DiscountProfile[];
  onOpenChange: (open: boolean) => void;
  onUpdated: () => Promise<void> | void;
}

export const AccountPricingSheet: React.FC<AccountPricingSheetProps> = ({
  open,
  account,
  discountProfiles,
  onOpenChange,
  onUpdated,
}: AccountPricingSheetProps) => {
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [assignedPolicyId, setAssignedPolicyId] = useState<number | null>(null);
  const [newPolicyName, setNewPolicyName] = useState('');
  const [existingPolicyId, setExistingPolicyId] = useState<number | null>(null);
  const [policyNameDraft, setPolicyNameDraft] = useState('');
  const [policyActive, setPolicyActive] = useState(true);
  const [discountDrafts, setDiscountDrafts] = useState<Record<number, number>>(
    {},
  );
  const [busyAction, setBusyAction] = useState<
    'create' | 'link' | 'unlink' | 'delete' | 'save' | null
  >(null);
  const [showPolicyTools, setShowPolicyTools] = useState(false);
  const [assignmentNotice, setAssignmentNotice] = useState('');
  const firstDiscountInputRef = useRef<HTMLInputElement>(null);

  const selectedPolicy = useMemo(
    () => discountProfiles.find((profile) => profile.id === assignedPolicyId),
    [assignedPolicyId, discountProfiles],
  );

  const selectablePolicies = useMemo(
    () =>
      discountProfiles.filter(
        (profile) => profile.isActive && profile.id !== assignedPolicyId,
      ),
    [assignedPolicyId, discountProfiles],
  );

  const selectedPolicyAccountCount = selectedPolicy?.accountCount ?? 0;
  const isSharedPolicy = selectedPolicyAccountCount > 1;
  const canDeleteSelectedPolicy = selectedPolicyAccountCount === 1;
  const createPolicyLabel = selectedPolicy
    ? 'Create separate policy'
    : 'Create new policy';
  const useExistingPolicyLabel = selectedPolicy
    ? 'Use another policy'
    : 'Use existing policy';
  const hasSelectablePolicies = selectablePolicies.length > 0;

  const loadItemTypes = useCallback(async () => {
    const rows = await window.electron.getItemTypes();
    setItemTypes(rows);
  }, []);

  const loadPolicyDiscounts = useCallback(async (profileId: number) => {
    const rows = await window.electron.getDiscountProfileTypeDiscounts(
      profileId,
    );
    setDiscountDrafts(
      rows.reduce(
        (acc, row) => ({
          ...acc,
          [row.itemTypeId]: row.discountPercent,
        }),
        {},
      ),
    );
  }, []);

  // load item types whenever the pricing sheet opens.
  useEffect(() => {
    if (!open) return;
    loadItemTypes();
  }, [loadItemTypes, open]);

  // sync local policy state whenever a different account is opened.
  useEffect(() => {
    if (!open) return;
    setAssignedPolicyId(account?.discountProfileId ?? null);
    setNewPolicyName(account?.name ?? '');
    setExistingPolicyId(null);
    setAssignmentNotice('');
    setShowPolicyTools(!(account?.discountProfileId ?? null));
  }, [account?.discountProfileId, account?.id, account?.name, open]);

  // keep the editable policy fields aligned with the selected policy.
  useEffect(() => {
    if (!selectedPolicy) {
      setPolicyNameDraft('');
      setPolicyActive(true);
      return;
    }

    setPolicyNameDraft(selectedPolicy.name);
    setPolicyActive(!!selectedPolicy.isActive);
  }, [selectedPolicy]);

  // load type discounts whenever the assigned policy changes.
  useEffect(() => {
    if (!open || !assignedPolicyId) {
      setDiscountDrafts({});
      return;
    }

    loadPolicyDiscounts(assignedPolicyId);
  }, [assignedPolicyId, loadPolicyDiscounts, open]);

  // focus the first discount input once pricing is attached and ready to edit.
  useEffect(() => {
    if (!open || !selectedPolicy) return;

    const timer = window.setTimeout(() => {
      firstDiscountInputRef.current?.focus();
      firstDiscountInputRef.current?.select();
    }, 50);

    return () => window.clearTimeout(timer);
  }, [open, selectedPolicy]);

  const handleCreatePolicy = async () => {
    if (!account) return;

    const name = newPolicyName.trim();
    if (!name) {
      toast({
        description: 'Enter a policy name first',
        variant: 'destructive',
      });
      return;
    }

    try {
      setBusyAction('create');
      const created = await window.electron.insertDiscountProfile(name);
      if (!created) {
        toast({
          description: 'Failed to create discount policy',
          variant: 'destructive',
        });
        return;
      }

      const profiles = await window.electron.getDiscountProfiles();
      const createdPolicy = profiles.find((profile) => profile.name === name);
      if (!createdPolicy) {
        toast({
          description: 'Policy was created but could not be loaded',
          variant: 'destructive',
        });
        return;
      }

      const linked = await window.electron.updateAccountDiscountProfile(
        account.id,
        createdPolicy.id,
      );
      if (!linked) {
        toast({
          description: 'Failed to assign the new policy to this account',
          variant: 'destructive',
        });
        return;
      }

      setAssignedPolicyId(createdPolicy.id);
      setExistingPolicyId(null);
      setShowPolicyTools(false);
      setAssignmentNotice(
        `${account.name} is now using policy "${createdPolicy.name}".`,
      );
      await Promise.resolve(onUpdated());
      toast({
        description: 'Discount policy created and assigned',
        variant: 'success',
      });
    } catch (error) {
      toast({
        description: `Unable to create policy: ${error}`,
        variant: 'destructive',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleAssignExistingPolicy = async () => {
    if (!account || !existingPolicyId) return;

    try {
      setBusyAction('link');
      const linked = await window.electron.updateAccountDiscountProfile(
        account.id,
        existingPolicyId,
      );
      if (!linked) {
        toast({
          description: 'Failed to assign discount policy',
          variant: 'destructive',
        });
        return;
      }

      setAssignedPolicyId(existingPolicyId);
      setShowPolicyTools(false);
      setAssignmentNotice(
        `${account.name} is now using policy "${
          discountProfiles.find((profile) => profile.id === existingPolicyId)
            ?.name || 'selected policy'
        }".`,
      );
      await Promise.resolve(onUpdated());
      toast({
        description: 'Discount policy assigned',
        variant: 'success',
      });
    } catch (error) {
      toast({
        description: `Unable to assign policy: ${error}`,
        variant: 'destructive',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemovePolicy = async () => {
    if (!account || !assignedPolicyId) return;

    try {
      setBusyAction('unlink');
      const unlinked = await window.electron.updateAccountDiscountProfile(
        account.id,
        null,
      );
      if (!unlinked) {
        toast({
          description: 'Failed to remove discount policy',
          variant: 'destructive',
        });
        return;
      }

      setAssignedPolicyId(null);
      setExistingPolicyId(null);
      setShowPolicyTools(true);
      setAssignmentNotice('');
      await Promise.resolve(onUpdated());
      toast({
        description: 'Discount policy removed from this account',
        variant: 'success',
      });
    } catch (error) {
      toast({
        description: `Unable to remove policy: ${error}`,
        variant: 'destructive',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeletePolicy = async () => {
    if (!account || !selectedPolicy || selectedPolicyAccountCount !== 1) return;

    // eslint-disable-next-line no-alert
    const confirmed = window.confirm(
      `Delete policy "${selectedPolicy.name}"? This will also remove it from "${account.name}". This cannot be undone.`,
    );
    if (!confirmed) return;

    try {
      setBusyAction('delete');
      const deleted = await window.electron.deleteDiscountProfileFromAccount(
        account.id,
        selectedPolicy.id,
      );
      if (!deleted) {
        toast({
          description:
            'Failed to delete policy. Make sure it is only used by this account.',
          variant: 'destructive',
        });
        return;
      }

      setAssignedPolicyId(null);
      setExistingPolicyId(null);
      setShowPolicyTools(true);
      setAssignmentNotice('');
      await Promise.resolve(onUpdated());
      toast({
        description: 'Policy deleted and removed from this account',
        variant: 'success',
      });
    } catch (error) {
      toast({
        description: `Unable to delete policy: ${error}`,
        variant: 'destructive',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSavePolicyDetails = async () => {
    if (!selectedPolicy) return;

    const nextName = policyNameDraft.trim();
    if (!nextName) {
      toast({
        description: 'Policy name cannot be empty',
        variant: 'destructive',
      });
      return;
    }

    try {
      setBusyAction('save');

      if (nextName !== selectedPolicy.name) {
        const renamed = await window.electron.updateDiscountProfileName(
          selectedPolicy.id,
          nextName,
        );
        if (!renamed) {
          toast({
            description: 'Failed to rename discount policy',
            variant: 'destructive',
          });
          return;
        }
      }

      if (policyActive !== !!selectedPolicy.isActive) {
        const toggled = await window.electron.toggleDiscountProfileActive(
          selectedPolicy.id,
          policyActive,
        );
        if (!toggled) {
          toast({
            description: 'Failed to update policy status',
            variant: 'destructive',
          });
          return;
        }
      }

      await Promise.resolve(onUpdated());
      toast({ description: 'Policy details saved', variant: 'success' });
    } catch (error) {
      toast({
        description: `Unable to save policy details: ${error}`,
        variant: 'destructive',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveDiscounts = async () => {
    if (!selectedPolicy) return;

    try {
      setBusyAction('save');

      const payload = itemTypes.map((itemType) => ({
        itemTypeId: itemType.id,
        discountPercent: getFixedNumber(
          Math.max(
            0,
            Math.min(100, toNumber(discountDrafts[itemType.id] ?? 0)),
          ),
          2,
        ),
      }));

      const saved = await window.electron.saveDiscountProfileTypeDiscounts(
        selectedPolicy.id,
        payload,
      );
      if (!saved) {
        toast({
          description: 'Failed to save policy discounts',
          variant: 'destructive',
        });
        return;
      }

      await Promise.resolve(onUpdated());
      toast({
        description: 'Discounts saved',
        variant: 'success',
      });
    } catch (error) {
      toast({
        description: `Unable to save discounts: ${error}`,
        variant: 'destructive',
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader className="pr-10">
          <SheetTitle>Pricing</SheetTitle>
          <SheetDescription>
            Set discount by item type for this account.
          </SheetDescription>
        </SheetHeader>

        {account ? (
          <div className="mt-6 space-y-5">
            <Card>
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Account
                    </p>
                    <h2 className="break-words text-2xl font-semibold leading-tight">
                      {account.name}
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Policy</span>
                    <span className="font-medium text-foreground">
                      {selectedPolicy?.name || 'Not set yet'}
                    </span>
                    {selectedPolicy && !selectedPolicy.isActive && (
                      <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
                        Inactive
                      </span>
                    )}
                  </div>
                  {assignmentNotice && (
                    <p className="text-sm font-medium text-emerald-700">
                      {assignmentNotice}
                    </p>
                  )}
                  {selectedPolicy && !selectedPolicy.isActive && (
                    <p className="text-sm text-muted-foreground">
                      Inactive policies do not auto-apply discounts on new
                      invoices.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {selectedPolicy && (
                    <div className="inline-flex h-9 items-center rounded-full border bg-muted/40 px-3 text-xs font-medium text-muted-foreground">
                      {isSharedPolicy
                        ? `${selectedPolicyAccountCount} accounts share this policy`
                        : 'Only this account uses this policy'}
                    </div>
                  )}
                  {selectedPolicy && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 px-4"
                      onClick={() => setShowPolicyTools((prev) => !prev)}
                    >
                      {showPolicyTools ? 'Hide tools' : 'Change'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {selectedPolicy && (
              <Card>
                <CardHeader className="gap-2 pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">Discounts</CardTitle>
                    <CardDescription>
                      {isSharedPolicy
                        ? `Changes here affect ${selectedPolicyAccountCount} accounts using this policy.`
                        : 'These discounts apply only to this account.'}
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    className="h-10 min-w-[150px]"
                    onClick={handleSaveDiscounts}
                    disabled={busyAction !== null}
                  >
                    Save discounts
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {itemTypes.length > 0 ? (
                    <div className="overflow-hidden rounded-md border">
                      <div className="grid grid-cols-[minmax(0,1fr)_180px] bg-muted px-4 py-2 text-sm font-medium">
                        <p>Item Type</p>
                        <p>Discount %</p>
                      </div>
                      {itemTypes.map((itemType, index) => (
                        <div
                          key={itemType.id}
                          className="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-4 border-t px-4 py-3"
                        >
                          <div className="flex items-center gap-2">
                            <span>{itemType.name}</span>
                            {!itemType.isActive && (
                              <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">
                                Inactive
                              </span>
                            )}
                          </div>
                          <Input
                            ref={
                              index === 0 ? firstDiscountInputRef : undefined
                            }
                            className="my-0"
                            type="number"
                            min={0}
                            max={100}
                            value={discountDrafts[itemType.id] ?? 0}
                            onChange={(e) =>
                              setDiscountDrafts((prev) => ({
                                ...prev,
                                [itemType.id]: toNumber(e.target.value),
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No item types are available yet. Add item types from the
                      Inventory page first.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {(!selectedPolicy || showPolicyTools) && (
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-lg">
                    {selectedPolicy ? 'Policy tools' : 'Set up pricing'}
                  </CardTitle>
                  <CardDescription>
                    {selectedPolicy
                      ? 'Use these actions only when you need to change or replace the current policy.'
                      : 'Create a policy for this account or link one that already exists.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {selectedPolicy && (
                    <>
                      <div className="space-y-3">
                        <p className="text-sm font-semibold">Policy details</p>
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_150px] lg:items-end">
                          <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">
                              Name
                            </p>
                            <Input
                              className="my-0"
                              value={policyNameDraft}
                              onChange={(e) =>
                                setPolicyNameDraft(e.target.value)
                              }
                              placeholder="Policy name"
                            />
                          </div>
                          <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">
                              Status
                            </p>
                            <div className="flex h-10 items-center gap-3 rounded-md border px-3">
                              <Checkbox
                                className="h-5 w-5 rounded-md"
                                checked={policyActive}
                                onCheckedChange={(checked) =>
                                  setPolicyActive(checked === true)
                                }
                              />
                              <span className="text-sm font-medium leading-none">
                                Active
                              </span>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 w-full"
                            onClick={handleSavePolicyDetails}
                            disabled={busyAction !== null}
                          >
                            Save details
                          </Button>
                        </div>
                      </div>
                      <Separator />
                    </>
                  )}

                  {(!selectedPolicy || isSharedPolicy) && (
                    <>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold">
                            {createPolicyLabel}
                          </p>
                          {selectedPolicy && (
                            <p className="text-sm text-muted-foreground">
                              Starts a new blank policy for this account and
                              leaves the shared one unchanged.
                            </p>
                          )}
                        </div>
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px] md:items-center">
                          <Input
                            className="my-0"
                            value={newPolicyName}
                            onChange={(e) => setNewPolicyName(e.target.value)}
                            placeholder="New policy name"
                          />
                          <Button
                            type="button"
                            className="h-10 w-full"
                            onClick={handleCreatePolicy}
                            disabled={busyAction !== null}
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            {selectedPolicy
                              ? 'Create separate'
                              : 'Create & use'}
                          </Button>
                        </div>
                      </div>
                      <Separator />
                    </>
                  )}

                  <div className="space-y-3">
                    <p className="text-sm font-semibold">
                      {useExistingPolicyLabel}
                    </p>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px] md:items-center">
                      <VirtualSelect
                        options={selectablePolicies}
                        value={existingPolicyId}
                        onChange={(value) => setExistingPolicyId(Number(value))}
                        disabled={!hasSelectablePolicies || busyAction !== null}
                        placeholder={
                          hasSelectablePolicies
                            ? 'Select a policy'
                            : 'No other active policies'
                        }
                        searchPlaceholder="Search policies..."
                        triggerClassName="h-10"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 w-full"
                        onClick={handleAssignExistingPolicy}
                        disabled={busyAction !== null || !existingPolicyId}
                      >
                        <Link2 className="mr-2 h-4 w-4" />
                        {selectedPolicy ? 'Use selected' : 'Link policy'}
                      </Button>
                    </div>
                    {!hasSelectablePolicies && (
                      <p className="text-sm text-muted-foreground">
                        No other active policies are available yet.
                      </p>
                    )}
                  </div>

                  {selectedPolicy && (
                    <>
                      <Separator />
                      <div className="space-y-3">
                        <p className="text-sm font-semibold">
                          Account assignment
                        </p>
                        <div className="rounded-md border bg-muted/20 p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm text-muted-foreground">
                              {canDeleteSelectedPolicy
                                ? 'Keep the policy for later, but remove it from this account.'
                                : 'Remove only this account from the shared policy. Other accounts will keep using it.'}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-10 min-w-max justify-center"
                              onClick={handleRemovePolicy}
                              disabled={busyAction !== null}
                            >
                              <Unlink2 className="mr-2 h-4 w-4" />
                              Unlink from account
                            </Button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {selectedPolicy && canDeleteSelectedPolicy && (
                    <>
                      <Separator />
                      <div className="space-y-3">
                        <p className="text-sm font-semibold text-destructive">
                          Danger zone
                        </p>
                        <div className="rounded-md border border-destructive/20 bg-destructive/5 p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm text-muted-foreground">
                              Delete this policy completely. This also removes
                              it from this account.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-10 min-w-[160px] justify-center text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={handleDeletePolicy}
                              disabled={busyAction !== null}
                            >
                              Delete policy
                            </Button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};
