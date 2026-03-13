import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Account, DiscountProfile, ItemType } from 'types';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/renderer/shad/ui/sheet';
import { toast } from '@/renderer/shad/ui/use-toast';
import { getFixedNumber } from '@/renderer/lib/utils';
import type {
  AssignmentProps,
  BusyAction,
  CreatePolicyProps,
  ExistingPolicyProps,
  PolicyDetailsProps,
} from './types';
import { AccountPricingHeaderCard } from './HeaderCard';
import { AccountPricingDiscountsCard } from './DiscountsCard';
import { AccountPricingToolsCard } from './ToolsCard';

interface AccountPricingSheetProps {
  open: boolean;
  account?: Account;
  discountProfiles: DiscountProfile[];
  onOpenChange: (open: boolean) => void;
  onUpdated: () => Promise<void> | void;
}

const normalizePolicyName = (value: string) => value.trim().toLowerCase();

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
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [showPolicyTools, setShowPolicyTools] = useState(false);
  const [assignmentNotice, setAssignmentNotice] = useState('');
  const firstDiscountInputRef = useRef<HTMLInputElement>(null);

  const selectedPolicy = useMemo(
    () => discountProfiles.find((profile) => profile.id === assignedPolicyId),
    [assignedPolicyId, discountProfiles],
  );
  const renamePolicyConflict = useMemo(() => {
    if (!selectedPolicy) return null;

    const normalizedDraftName = normalizePolicyName(policyNameDraft);
    if (!normalizedDraftName) return null;
    if (normalizedDraftName === normalizePolicyName(selectedPolicy.name)) {
      return null;
    }

    return (
      discountProfiles.find(
        (profile) =>
          profile.id !== selectedPolicy.id &&
          normalizePolicyName(profile.name) === normalizedDraftName,
      ) || null
    );
  }, [discountProfiles, policyNameDraft, selectedPolicy]);
  const draftPolicyMatch = useMemo(() => {
    const normalizedDraftName = normalizePolicyName(newPolicyName);
    if (!normalizedDraftName) return null;

    return (
      discountProfiles.find(
        (profile) => normalizePolicyName(profile.name) === normalizedDraftName,
      ) || null
    );
  }, [discountProfiles, newPolicyName]);

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
  const canSavePolicyDetails =
    !!selectedPolicy &&
    busyAction === null &&
    !!policyNameDraft.trim() &&
    !renamePolicyConflict;
  const hasSelectedPolicy = !!selectedPolicy;

  /** surface contextual hints when user types a new policy name that matches an existing profile */
  const createPolicyHint = useMemo(() => {
    if (!draftPolicyMatch) return null;

    // you're trying to create a separate policy but reusing the same name as the current one
    if (draftPolicyMatch.id === assignedPolicyId) {
      return {
        tone: 'warning' as const,
        text: 'Choose a different name for the separate policy.',
      };
    }

    // you're trying to create a new policy with a name that already belongs to an unused policy.
    if ((draftPolicyMatch.accountCount ?? 0) === 0) {
      return {
        tone: 'muted' as const,
        text: 'Saved policy with this name will be reused.',
      };
    }

    // you're trying to create a new policy with a name that already belongs to another active policy that's in use.
    if (draftPolicyMatch.isActive) {
      return {
        tone: 'warning' as const,
        text: 'This name already exists. Use existing policy below or choose a different name.',
      };
    }

    // you're trying to create a new policy name that's already used by a policy that's currently auto-off.
    return {
      tone: 'warning' as const,
      text: 'This name already exists and is auto off. Choose a different name or turn that policy on first.',
    };
  }, [assignedPolicyId, draftPolicyMatch]);

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

  const attachPolicyToAccount = useCallback(
    async (profileId: number, successDescription: string, notice: string) => {
      if (!account) return false;

      const linked = await window.electron.updateAccountDiscountProfile(
        account.id,
        profileId,
      );
      if (!linked) {
        toast({
          description: 'Failed to assign discount policy',
          variant: 'destructive',
        });
        return false;
      }

      setAssignedPolicyId(profileId);
      setExistingPolicyId(null);
      setShowPolicyTools(false);
      setAssignmentNotice(notice);
      await Promise.resolve(onUpdated());
      toast({
        description: successDescription,
        variant: 'success',
      });
      return true;
    },
    [account, onUpdated],
  );

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

      if (draftPolicyMatch) {
        if (draftPolicyMatch.id === assignedPolicyId) {
          return;
        }

        if ((draftPolicyMatch.accountCount ?? 0) === 0) {
          if (!draftPolicyMatch.isActive) {
            const activated = await window.electron.toggleDiscountProfileActive(
              draftPolicyMatch.id,
              true,
            );
            if (!activated) {
              toast({
                description: 'Failed to reuse the saved policy',
                variant: 'destructive',
              });
              return;
            }
          }

          await attachPolicyToAccount(
            draftPolicyMatch.id,
            'Saved policy reused',
            `${account.name} is now using policy "${draftPolicyMatch.name}".`,
          );
          return;
        }

        if (
          draftPolicyMatch.isActive &&
          draftPolicyMatch.id !== assignedPolicyId
        ) {
          setExistingPolicyId(draftPolicyMatch.id);
        }
        return;
      }

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

      await attachPolicyToAccount(
        createdPolicy.id,
        'Discount policy created and assigned',
        `${account.name} is now using policy "${createdPolicy.name}".`,
      );
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
      await attachPolicyToAccount(
        existingPolicyId,
        'Discount policy assigned',
        `${account.name} is now using policy "${
          discountProfiles.find((profile) => profile.id === existingPolicyId)
            ?.name || 'selected policy'
        }".`,
      );
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
    if (renamePolicyConflict) {
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
      if (String(error).includes('UNIQUE')) {
        toast({
          description:
            'Policy name is already in use. Choose a different name.',
          variant: 'destructive',
        });
        return;
      }
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

      const payload = itemTypes.map((itemType) => {
        const rawDraft = discountDrafts[itemType.id] ?? 0;
        const bounded = Math.max(0, Math.min(100, rawDraft));

        return {
          itemTypeId: itemType.id,
          discountPercent: getFixedNumber(bounded, 2),
        };
      });

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

  const policyDetailsProps: PolicyDetailsProps = {
    policyNameDraft,
    renamePolicyConflict,
    policyActive,
    canSavePolicyDetails,
    onChangePolicyNameDraft: (value: string) => setPolicyNameDraft(value),
    onTogglePolicyActive: (next: boolean) => setPolicyActive(next),
    onSavePolicyDetails: handleSavePolicyDetails,
  };

  const createPolicyProps: CreatePolicyProps = {
    createPolicyLabel,
    newPolicyName,
    createPolicyHint,
    busyAction,
    onChangeNewPolicyName: (value: string) => setNewPolicyName(value),
    onCreatePolicy: handleCreatePolicy,
  };

  const existingPolicyProps: ExistingPolicyProps = {
    useExistingPolicyLabel,
    selectablePolicies,
    existingPolicyId,
    hasSelectablePolicies,
    busyAction,
    onChangeExistingPolicyId: (value: number) => setExistingPolicyId(value),
    onAssignExistingPolicy: handleAssignExistingPolicy,
  };

  const assignmentProps: AssignmentProps = {
    canDeleteSelectedPolicy,
    busyAction,
    onRemovePolicy: handleRemovePolicy,
    onDeletePolicy: handleDeletePolicy,
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader className="pr-10">
          <SheetTitle>Policy</SheetTitle>
          <SheetDescription>
            Manage discount policy by item type for this account.
          </SheetDescription>
        </SheetHeader>

        {account ? (
          <div className="mt-6 space-y-5">
            <AccountPricingHeaderCard
              account={account}
              selectedPolicy={selectedPolicy}
              selectedPolicyAccountCount={selectedPolicyAccountCount}
              isSharedPolicy={isSharedPolicy}
              assignmentNotice={assignmentNotice}
              showPolicyTools={showPolicyTools}
              onTogglePolicyTools={() =>
                setShowPolicyTools((previous) => !previous)
              }
            />

            <AccountPricingDiscountsCard
              selectedPolicy={selectedPolicy}
              isSharedPolicy={isSharedPolicy}
              selectedPolicyAccountCount={selectedPolicyAccountCount}
              itemTypes={itemTypes}
              discountDrafts={discountDrafts}
              busyAction={busyAction}
              onChangeDiscountDraft={(itemTypeId, value) =>
                setDiscountDrafts((previous) => ({
                  ...previous,
                  [itemTypeId]: value,
                }))
              }
              onSaveDiscounts={handleSaveDiscounts}
              firstDiscountInputRef={firstDiscountInputRef}
            />

            <AccountPricingToolsCard
              hasSelectedPolicy={hasSelectedPolicy}
              isSharedPolicy={isSharedPolicy}
              policyDetails={policyDetailsProps}
              createPolicy={createPolicyProps}
              existingPolicy={existingPolicyProps}
              assignment={assignmentProps}
            />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};
