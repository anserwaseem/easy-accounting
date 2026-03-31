import type { DiscountProfile } from 'types';

export type BusyAction =
  | 'create'
  | 'link'
  | 'unlink'
  | 'delete'
  | 'save'
  | null;

export type CreatePolicyHint = {
  tone: 'warning' | 'muted';
  text: string;
} | null;

export type RenamePolicyConflict = DiscountProfile | null;

export type PolicyDetailsProps = {
  policyNameDraft: string;
  renamePolicyConflict: RenamePolicyConflict;
  policyActive: boolean;
  canSavePolicyDetails: boolean;
  onChangePolicyNameDraft: (value: string) => void;
  onTogglePolicyActive: (next: boolean) => void;
  onSavePolicyDetails: () => void;
};

export type CreatePolicyProps = {
  createPolicyLabel: string;
  newPolicyName: string;
  createPolicyHint: CreatePolicyHint;
  busyAction: BusyAction;
  onChangeNewPolicyName: (value: string) => void;
  onCreatePolicy: () => void;
};

export type ExistingPolicyProps = {
  useExistingPolicyLabel: string;
  selectablePolicies: DiscountProfile[];
  existingPolicyId: number | null;
  hasSelectablePolicies: boolean;
  busyAction: BusyAction;
  onChangeExistingPolicyId: (value: number) => void;
  onAssignExistingPolicy: () => void;
};

export type AssignmentProps = {
  canDeleteSelectedPolicy: boolean;
  busyAction: BusyAction;
  onRemovePolicy: () => void;
  onDeletePolicy: () => void;
};

export type PolicyToolsCardProps = {
  hasSelectedPolicy: boolean;
  isSharedPolicy: boolean;
  policyDetails: PolicyDetailsProps;
  createPolicy: CreatePolicyProps;
  existingPolicy: ExistingPolicyProps;
  assignment: AssignmentProps;
};
