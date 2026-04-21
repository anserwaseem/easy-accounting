import VirtualSelect from '@/renderer/components/VirtualSelect';
import { getFixedNumber } from '@/renderer/lib/utils';
import {
  FormField,
  FormItem,
  FormMessage,
  FormControl,
} from '@/renderer/shad/ui/form';
import { Input } from '@/renderer/shad/ui/input';
import { type Account } from '@/types';
import { toNumber, toString } from 'lodash';
import { useState } from 'react';
import { type FormType } from './schema';

export const AccountCell = ({
  rowIndex,
  form,
  accounts,
}: {
  rowIndex: number;
  form: FormType;
  accounts: Account[] | undefined;
}) => {
  return (
    <FormField
      control={form.control}
      name={`journalEntries.${rowIndex}.accountId` as const}
      render={({ field }) => (
        <FormItem className="w-full space-y-0" id={`account-cell-${rowIndex}`}>
          <VirtualSelect
            options={accounts || []}
            value={field.value?.toString()}
            onChange={(val) => {
              field.onChange(toString(val));
              setTimeout(() => {
                document.getElementById(`debit-input-${rowIndex}`)?.focus();
              }, 50);
            }}
            placeholder="Select account"
            searchPlaceholder="Search accounts..."
          />
          <FormMessage />
        </FormItem>
      )}
    />
  );
};

export const DebitCell = ({
  rowIndex,
  form,
  removeDefaultLabel,
  getAmountDefaultLabel,
  formatStringWithGrouping,
  formatAmountForDisplay,
}: {
  rowIndex: number;
  form: FormType;
  removeDefaultLabel: (value: string) => string;
  getAmountDefaultLabel: (value: number) => string | number;
  formatStringWithGrouping: (value: string) => string;
  formatAmountForDisplay: (value: number | string) => string;
}) => {
  const [inputValue, setInputValue] = useState<string | undefined>(undefined);

  return (
    <FormField
      control={form.control}
      name={`journalEntries.${rowIndex}.debitAmount` as const}
      render={({ field }) => {
        const displayValue = (() => {
          if (inputValue !== undefined) {
            return inputValue === ''
              ? ''
              : formatStringWithGrouping(inputValue);
          }
          return field.value === 0
            ? getAmountDefaultLabel(field.value)
            : formatAmountForDisplay(field.value);
        })();

        return (
          <FormItem className="space-y-0">
            <FormControl>
              <Input
                {...field}
                id={`debit-input-${rowIndex}`}
                value={displayValue}
                type="text"
                inputMode="decimal"
                onChange={(e) => {
                  const sanitized = removeDefaultLabel(e.target.value);
                  setInputValue(sanitized);
                  field.onChange(toNumber(sanitized));
                }}
                onBlur={(e) => {
                  const sanitized = removeDefaultLabel(e.target.value);
                  const val = getFixedNumber(toNumber(sanitized), 2);
                  const latestJournal = form.getValues();
                  if (
                    val > 0 &&
                    latestJournal.journalEntries[rowIndex]?.creditAmount !== 0
                  ) {
                    form.setValue(
                      `journalEntries.${rowIndex}.creditAmount` as const,
                      0,
                    );
                    field.onChange(val);
                  } else {
                    field.onChange(val);
                  }
                  setInputValue(undefined);
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
};

export const CreditCell = ({
  rowIndex,
  form,
  removeDefaultLabel,
  getAmountDefaultLabel,
  formatStringWithGrouping,
  formatAmountForDisplay,
}: {
  rowIndex: number;
  form: FormType;
  removeDefaultLabel: (value: string) => string;
  getAmountDefaultLabel: (value: number) => string | number;
  formatStringWithGrouping: (value: string) => string;
  formatAmountForDisplay: (value: number | string) => string;
}) => {
  const [inputValue, setInputValue] = useState<string | undefined>(undefined);

  return (
    <FormField
      control={form.control}
      name={`journalEntries.${rowIndex}.creditAmount` as const}
      render={({ field }) => {
        const displayValue = (() => {
          if (inputValue !== undefined) {
            return inputValue === ''
              ? ''
              : formatStringWithGrouping(inputValue);
          }
          return field.value === 0
            ? getAmountDefaultLabel(field.value)
            : formatAmountForDisplay(field.value);
        })();

        return (
          <FormItem className="space-y-0">
            <FormControl>
              <Input
                {...field}
                id={`credit-input-${rowIndex}`}
                value={displayValue}
                type="text"
                inputMode="decimal"
                onChange={(e) => {
                  const sanitized = removeDefaultLabel(e.target.value);
                  setInputValue(sanitized);
                  field.onChange(toNumber(sanitized));
                }}
                onBlur={(e) => {
                  const sanitized = removeDefaultLabel(e.target.value);
                  const val = getFixedNumber(toNumber(sanitized), 2);
                  const latestJournal = form.getValues();
                  if (
                    val > 0 &&
                    latestJournal.journalEntries[rowIndex]?.debitAmount !== 0
                  ) {
                    form.setValue(
                      `journalEntries.${rowIndex}.debitAmount` as const,
                      0,
                    );
                    field.onChange(val);
                  } else {
                    field.onChange(val);
                  }
                  setInputValue(undefined);
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
};
