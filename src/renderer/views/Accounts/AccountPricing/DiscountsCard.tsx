import type React from 'react';
import type { RefObject } from 'react';
import type { ItemType, DiscountProfile } from 'types';
import { toNumber } from 'lodash';
import { Button } from '@/renderer/shad/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/renderer/shad/ui/card';
import { Input } from '@/renderer/shad/ui/input';
import type { BusyAction } from './types';

interface DiscountsCardProps {
  selectedPolicy?: DiscountProfile;
  isSharedPolicy: boolean;
  selectedPolicyAccountCount: number;
  itemTypes: ItemType[];
  discountDrafts: Record<number, number>;
  busyAction: BusyAction;
  onChangeDiscountDraft: (itemTypeId: number, value: number) => void;
  onSaveDiscounts: () => void;
  firstDiscountInputRef: RefObject<HTMLInputElement>;
}

export const AccountPricingDiscountsCard: React.FC<DiscountsCardProps> = ({
  selectedPolicy,
  isSharedPolicy,
  selectedPolicyAccountCount,
  itemTypes,
  discountDrafts,
  busyAction,
  onChangeDiscountDraft,
  onSaveDiscounts,
  firstDiscountInputRef,
}) => {
  if (!selectedPolicy) {
    return null;
  }

  return (
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
          onClick={onSaveDiscounts}
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
                  ref={index === 0 ? firstDiscountInputRef : undefined}
                  className="my-0"
                  type="number"
                  min={0}
                  max={100}
                  value={discountDrafts[itemType.id] ?? 0}
                  onChange={(event) =>
                    onChangeDiscountDraft(
                      itemType.id,
                      toNumber(event.target.value),
                    )
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No item types are available yet. Add item types from the Inventory
            page first.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
