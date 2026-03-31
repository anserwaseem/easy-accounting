import type React from 'react';
import { Link2, Plus, Unlink2 } from 'lucide-react';
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
import VirtualSelect from '@/renderer/components/VirtualSelect';
import type {
  AssignmentProps,
  CreatePolicyProps,
  ExistingPolicyProps,
  PolicyDetailsProps,
  PolicyToolsCardProps,
} from './types';

const renderPolicyDetailsSection = (policyDetails: PolicyDetailsProps) => (
  <>
    <div className="space-y-3">
      <p className="text-sm font-semibold">Policy details</p>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_150px] lg:items-end">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Name</p>
          <Input
            className="my-0"
            value={policyDetails.policyNameDraft}
            onChange={(event) =>
              policyDetails.onChangePolicyNameDraft(event.target.value)
            }
            placeholder="Policy name"
          />
          {policyDetails.renamePolicyConflict && (
            <p className="text-sm text-amber-700">
              Name already in use. Choose a different name.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Auto-apply on invoices
          </p>
          <div className="flex h-10 items-center gap-3 rounded-md border px-3">
            <Checkbox
              className="h-5 w-5 rounded-md"
              checked={policyDetails.policyActive}
              onCheckedChange={(checked) =>
                policyDetails.onTogglePolicyActive(checked === true)
              }
            />
            <span className="text-sm font-medium leading-none">Enabled</span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full"
          onClick={policyDetails.onSavePolicyDetails}
          disabled={!policyDetails.canSavePolicyDetails}
        >
          Save details
        </Button>
      </div>
    </div>
    <Separator />
  </>
);

const renderCreatePolicySection = (
  showSharedCopyHint: boolean,
  createPolicy: CreatePolicyProps,
) => (
  <>
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-semibold">
          {createPolicy.createPolicyLabel}
        </p>
        {showSharedCopyHint && (
          <p className="text-sm text-muted-foreground">
            Starts a new blank policy for this account and leaves the shared one
            unchanged.
          </p>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px] md:items-center">
        <Input
          className="my-0"
          value={createPolicy.newPolicyName}
          onChange={(event) =>
            createPolicy.onChangeNewPolicyName(event.target.value)
          }
          placeholder="New policy name"
        />
        <Button
          type="button"
          className="h-10 w-full"
          onClick={createPolicy.onCreatePolicy}
          disabled={createPolicy.busyAction !== null}
        >
          <Plus className="mr-2 h-4 w-4" />
          {showSharedCopyHint ? 'Create separate' : 'Set up policy'}
        </Button>
      </div>
      {createPolicy.createPolicyHint && (
        <p
          className={
            createPolicy.createPolicyHint.tone === 'warning'
              ? 'text-sm text-amber-700'
              : 'text-sm text-muted-foreground'
          }
        >
          {createPolicy.createPolicyHint.text}
        </p>
      )}
    </div>
    <Separator />
  </>
);

const renderUseExistingSection = (
  existingPolicy: ExistingPolicyProps,
  hasSelectedPolicy: boolean,
) => (
  <div className="space-y-3">
    <p className="text-sm font-semibold">
      {existingPolicy.useExistingPolicyLabel}
    </p>
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px] md:items-center">
      <VirtualSelect
        options={existingPolicy.selectablePolicies}
        value={existingPolicy.existingPolicyId}
        onChange={(value) =>
          existingPolicy.onChangeExistingPolicyId(Number(value))
        }
        disabled={
          !existingPolicy.hasSelectablePolicies ||
          existingPolicy.busyAction !== null
        }
        placeholder={
          existingPolicy.hasSelectablePolicies
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
        onClick={existingPolicy.onAssignExistingPolicy}
        disabled={
          existingPolicy.busyAction !== null || !existingPolicy.existingPolicyId
        }
      >
        <Link2 className="mr-2 h-4 w-4" />
        {hasSelectedPolicy ? 'Use selected' : 'Link policy'}
      </Button>
    </div>
    {!existingPolicy.hasSelectablePolicies && (
      <p className="text-sm text-muted-foreground">
        No other active policies are available yet.
      </p>
    )}
  </div>
);

const renderAssignmentSection = (assignment: AssignmentProps) => (
  <>
    <Separator />
    <div className="space-y-3">
      <p className="text-sm font-semibold">Account assignment</p>
      <div className="rounded-md border bg-muted/20 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {assignment.canDeleteSelectedPolicy
              ? 'Keep the policy for later, but remove it from this account.'
              : 'Remove only this account from the shared policy. Other accounts will keep using it.'}
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-10 min-w-max justify-center"
            onClick={assignment.onRemovePolicy}
            disabled={assignment.busyAction !== null}
          >
            <Unlink2 className="mr-2 h-4 w-4" />
            Unlink from account
          </Button>
        </div>
      </div>
    </div>
  </>
);

const renderDangerSection = (assignment: AssignmentProps) => (
  <>
    <Separator />
    <div className="space-y-3">
      <p className="text-sm font-semibold text-destructive">Danger zone</p>
      <div className="rounded-md border border-destructive/20 bg-destructive/5 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Delete this policy completely. This also removes it from this
            account.
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-10 min-w-[160px] justify-center text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={assignment.onDeletePolicy}
            disabled={assignment.busyAction !== null}
          >
            Delete policy
          </Button>
        </div>
      </div>
    </div>
  </>
);

export const AccountPricingToolsCard: React.FC<PolicyToolsCardProps> = ({
  hasSelectedPolicy,
  isSharedPolicy,
  policyDetails,
  createPolicy,
  existingPolicy,
  assignment,
}: PolicyToolsCardProps) => {
  if (!hasSelectedPolicy && !isSharedPolicy) {
    return (
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Set up policy</CardTitle>
          <CardDescription>
            Create a policy for this account or link one that already exists.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {renderCreatePolicySection(false, createPolicy)}
          {renderUseExistingSection(existingPolicy, false)}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">
          {hasSelectedPolicy ? 'Policy tools' : 'Set up policy'}
        </CardTitle>
        <CardDescription>
          {hasSelectedPolicy
            ? 'Use these actions only when you need to change or replace the current policy.'
            : 'Create a policy for this account or link one that already exists.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {hasSelectedPolicy && renderPolicyDetailsSection(policyDetails)}

        {renderCreatePolicySection(
          hasSelectedPolicy && isSharedPolicy,
          createPolicy,
        )}

        {renderUseExistingSection(existingPolicy, hasSelectedPolicy)}

        {hasSelectedPolicy && renderAssignmentSection(assignment)}

        {hasSelectedPolicy &&
          assignment.canDeleteSelectedPolicy &&
          renderDangerSection(assignment)}
      </CardContent>
    </Card>
  );
};
