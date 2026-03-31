import type React from 'react';
import type { Account, DiscountProfile } from 'types';
import { Button } from '@/renderer/shad/ui/button';
import { Card, CardContent } from '@/renderer/shad/ui/card';

interface AccountHeaderCardProps {
  account: Account;
  selectedPolicy?: DiscountProfile;
  selectedPolicyAccountCount: number;
  isSharedPolicy: boolean;
  assignmentNotice: string;
  showPolicyTools: boolean;
  onTogglePolicyTools: () => void;
}

export const AccountPricingHeaderCard: React.FC<AccountHeaderCardProps> = ({
  account,
  selectedPolicy,
  selectedPolicyAccountCount,
  isSharedPolicy,
  assignmentNotice,
  showPolicyTools,
  onTogglePolicyTools,
}) => (
  <Card>
    <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            account
          </p>
          <h2 className="break-words text-2xl font-semibold leading-tight">
            {account.name}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Policy</span>
          <span className="font-medium text-foreground">
            {selectedPolicy?.name || 'Not set up yet'}
          </span>
        </div>
        {assignmentNotice && (
          <p className="text-sm font-medium text-emerald-700">
            {assignmentNotice}
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
        {selectedPolicy && !selectedPolicy.isActive && (
          <div className="inline-flex h-9 items-center rounded-full border border-amber-200 bg-amber-50 px-3 text-xs font-medium text-amber-800">
            Auto off
          </div>
        )}
        {selectedPolicy && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 px-4"
            onClick={onTogglePolicyTools}
          >
            {showPolicyTools ? 'Hide tools' : 'Change'}
          </Button>
        )}
      </div>
    </CardContent>
  </Card>
);
