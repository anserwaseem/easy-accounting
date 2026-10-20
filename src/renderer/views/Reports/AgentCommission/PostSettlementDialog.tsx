import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Check, Loader2 } from 'lucide-react';
import type {
  Account,
  AgentCommissionReport,
  CommissionAdjustment,
  PostCommissionSettlementPayload,
} from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/shad/ui/dialog';
import { Button } from '@/renderer/shad/ui/button';
import { Input } from '@/renderer/shad/ui/input';
import { Label } from '@/renderer/shad/ui/label';
import { toast } from '@/renderer/shad/ui/use-toast';
import VirtualSelect from '@/renderer/components/VirtualSelect';

interface PostSettlementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: AgentCommissionReport;
  adjustments: CommissionAdjustment[];
  accounts: Account[];
  onSuccess: () => void;
}

export const PostSettlementDialog: React.FC<PostSettlementDialogProps> = ({
  open,
  onOpenChange,
  report,
  adjustments,
  accounts,
  onSuccess,
}: PostSettlementDialogProps) => {
  const [postingDate, setPostingDate] = useState<string>(
    report.endDate || new Date().toISOString().slice(0, 10),
  );
  const [payableAccountId, setPayableAccountId] = useState<number | null>(
    report.payableAccountId ?? null,
  );
  const [expenseAccountId, setExpenseAccountId] = useState<number | null>(
    report.expenseAccountId ?? null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !report) return;

    let isCancelled = false;

    // Reset immediately based on current agent's report
    setPostingDate(report.endDate || new Date().toISOString().slice(0, 10));
    setPayableAccountId(report.payableAccountId ?? null);
    setExpenseAccountId(report.expenseAccountId ?? null);

    // Always fetch fresh saved config for this agent directly from DB
    if (report.agentId != null) {
      window.electron
        .commissionGetConfig(report.agentId)
        .then((config) => {
          if (isCancelled) return;
          setPayableAccountId(
            config?.payableAccountId ?? report.payableAccountId ?? null,
          );
          setExpenseAccountId(
            config?.expenseAccountId ?? report.expenseAccountId ?? null,
          );
        })
        .catch((err) => {
          console.error(
            'Failed to fetch commission config for settlement:',
            err,
          );
        });
    }

    return () => {
      isCancelled = true;
    };
  }, [open, report]);

  const totalAdjustments = useMemo(
    () => adjustments.reduce((sum, adj) => sum + (adj.amount || 0), 0),
    [adjustments],
  );

  const netCommission = useMemo(
    () => Math.round(report.grossCommission + totalAdjustments),
    [report.grossCommission, totalAdjustments],
  );

  const payableAccount = useMemo(
    () => accounts.find((a) => a.id === payableAccountId),
    [accounts, payableAccountId],
  );

  const expenseAccount = useMemo(
    () => accounts.find((a) => a.id === expenseAccountId),
    [accounts, expenseAccountId],
  );

  const defaultNarration = useMemo(
    () =>
      `Commission settlement for ${report.agentName} (${report.startDate} to ${report.endDate})`,
    [report.agentName, report.startDate, report.endDate],
  );

  const handlePost = async () => {
    if (!payableAccountId) {
      toast({
        title: 'Missing Payable Account',
        description: 'Please select an Agent Payable account to credit.',
        variant: 'destructive',
      });
      return;
    }

    if (!expenseAccountId) {
      toast({
        title: 'Missing Expense Account',
        description: 'Please select a Commission Expense account to debit.',
        variant: 'destructive',
      });
      return;
    }

    if (payableAccountId === expenseAccountId) {
      toast({
        title: 'Accounts Must Differ',
        description: 'Payable account and Expense account cannot be the same.',
        variant: 'destructive',
      });
      return;
    }

    if (netCommission <= 0) {
      toast({
        title: 'Zero or Negative Amount',
        description:
          'Net commission payable must be greater than zero to post a settlement journal.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: PostCommissionSettlementPayload = {
        chartId: report.agentId,
        startDate: report.startDate,
        endDate: report.endDate,
        postingDate,
        payableAccountId,
        expenseAccountId,
        adjustments,
      };

      const result = await window.electron.commissionPostSettlement(payload);
      toast({
        title: 'Settlement Posted',
        description: `Successfully posted commission journal #${
          result.journalId
        } for Rs. ${netCommission.toLocaleString()}.`,
      });
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      console.error('Failed to post commission settlement:', error);
      // the guard refuses this when the commission module is off; the
      // toast layer turns that into a message the person can act on
      toast({
        title: 'Posting Failed',
        description:
          error instanceof Error
            ? error.message
            : 'Could not post settlement to ledger.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5 text-primary" />
            Post Commission to Ledger
          </DialogTitle>
          <DialogDescription>
            Generate a consolidated settlement journal entry for{' '}
            {report.agentName} for the period {report.startDate} to{' '}
            {report.endDate}.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-4 text-sm">
          {/* Posting Date */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Posting Date</Label>
            <Input
              type="date"
              className="h-9"
              value={postingDate}
              onChange={(e) => setPostingDate(e.target.value)}
            />
          </div>

          {/* Account Pickers */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Expense Account (Debit Dr)
              </Label>
              <VirtualSelect
                options={accounts}
                value={expenseAccountId}
                onChange={(val) => setExpenseAccountId(Number(val))}
                placeholder="Select Expense Account..."
                searchFields={['name', 'code', 'headName']}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Agent Payable (Credit Cr)
              </Label>
              <VirtualSelect
                options={accounts}
                value={payableAccountId}
                onChange={(val) => setPayableAccountId(Number(val))}
                placeholder="Select Payable Account..."
                searchFields={['name', 'code', 'headName']}
              />
            </div>
          </div>

          {/* Settlement Calculation Breakdown */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 text-xs">
            <div className="flex justify-between text-muted-foreground">
              <span>Gross Commission:</span>
              <span className="font-mono">
                Rs. {Math.round(report.grossCommission).toLocaleString()}
              </span>
            </div>
            {adjustments.length > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Manual Adjustments ({adjustments.length}):</span>
                <span className="font-mono">
                  {totalAdjustments >= 0 ? '+' : ''}Rs.{' '}
                  {Math.round(totalAdjustments).toLocaleString()}
                </span>
              </div>
            )}
            <div className="border-t pt-1.5 flex justify-between font-semibold text-sm text-foreground">
              <span>Net Commission Payable:</span>
              <span className="font-mono text-primary">
                Rs. {netCommission.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Journal Preview */}
          <div className="rounded-lg border p-3 bg-card space-y-2">
            <div className="text-xs font-semibold text-muted-foreground flex items-center justify-between">
              <span>Journal Entry Preview</span>
              <span className="text-[11px] font-normal">
                {defaultNarration}
              </span>
            </div>
            <div className="space-y-1 text-xs font-mono">
              <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                <span className="flex items-center gap-1.5">
                  <ArrowRight size={12} />
                  Dr {expenseAccount?.name || '[Expense Account]'}
                </span>
                <span>Rs. {netCommission.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between text-blue-600 dark:text-blue-400 pl-4">
                <span className="flex items-center gap-1.5">
                  <ArrowRight size={12} />
                  Cr {payableAccount?.name || '[Agent Payable Account]'}
                </span>
                <span>Rs. {netCommission.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            className="gap-1.5"
            onClick={handlePost}
            disabled={isSubmitting || netCommission <= 0}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Posting...
              </>
            ) : (
              <>
                <Check size={14} />
                Confirm & Post to Ledger
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
