import { Separator } from 'renderer/shad/ui/separator';
import { RadioGroup, RadioGroupItem } from 'renderer/shad/ui/radio-group';
import { Label } from 'renderer/shad/ui/label';
import { Input } from 'renderer/shad/ui/input';
import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from 'renderer/shad/ui/button';
import { toast } from 'renderer/shad/ui/use-toast';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { BLOCK_SAVE_WHEN_SPLIT_TYPED_ACCOUNT_MISSING_KEY } from '@/renderer/lib/invoiceBehaviorStore';
import type {
  InvoicePrintLabelKey,
  InvoicePrintLabels,
  InvoicePrintLocale,
} from '@/renderer/lib/invoicePrint/locale';
import {
  INVOICE_PRINT_LABEL_KEYS,
  INVOICE_PRINT_LABEL_TITLES,
} from '@/renderer/lib/invoicePrint/locale';
import { useCompanyProfile, useInvoicePrintSettings } from '@/renderer/hooks';
import PublishSettings from './PublishSettings';

const SettingsPage: React.FC = () => {
  // eslint-disable-next-line no-console
  console.log('Settings page');
  const defaultLabels = [' ', '0', '-', 'X'];
  const [debitCreditDefaultLabel, setDebitCreditDefaultLabel] = useState<
    (typeof defaultLabels)[number]
  >(window.electron.store.get('debitCreditDefaultLabel') ?? defaultLabels[0]);

  const { profile: companyProfile, saveCompanyProfile } = useCompanyProfile();
  const [draftCompanyName, setDraftCompanyName] = useState(companyProfile.name);
  const [draftCompanyAddress, setDraftCompanyAddress] = useState(
    companyProfile.address,
  );
  const [draftCompanyPhone, setDraftCompanyPhone] = useState(
    companyProfile.phone,
  );
  const [draftCompanyEmail, setDraftCompanyEmail] = useState(
    companyProfile.email,
  );
  const [draftCompanyNameUrdu, setDraftCompanyNameUrdu] = useState(
    companyProfile.nameUrdu,
  );
  const [draftCompanyAddressUrdu, setDraftCompanyAddressUrdu] = useState(
    companyProfile.addressUrdu,
  );

  const {
    settings: invoicePrintSettings,
    saveInvoicePrintSettings,
    defaults: invoicePrintDefaults,
  } = useInvoicePrintSettings();
  const [draftPrintLocale, setDraftPrintLocale] = useState<InvoicePrintLocale>(
    invoicePrintSettings.locale,
  );
  const [draftUrduLabelOverrides, setDraftUrduLabelOverrides] = useState<
    Partial<InvoicePrintLabels>
  >(() => ({ ...invoicePrintSettings.urduLabelOverrides }));
  const [urduLabelsExpanded, setUrduLabelsExpanded] = useState(false);

  const [
    allowSaveWhenSplitTypedAccountMissing,
    setAllowSaveWhenSplitTypedAccountMissing,
  ] = useState(
    () =>
      window.electron.store.get(
        BLOCK_SAVE_WHEN_SPLIT_TYPED_ACCOUNT_MISSING_KEY,
      ) === false,
  );

  const handleUrduLabelChange = useCallback(
    (key: InvoicePrintLabelKey, value: string) => {
      setDraftUrduLabelOverrides((prev) => {
        const next = { ...prev };
        if (value.trim().length === 0) {
          delete next[key];
        } else {
          next[key] = value;
        }
        return next;
      });
    },
    [],
  );

  const handleResetUrduLabels = useCallback(() => {
    setDraftUrduLabelOverrides({});
  }, []);

  const handleSaveSettings = useCallback(() => {
    window.electron.store.set(
      'debitCreditDefaultLabel',
      debitCreditDefaultLabel,
    );

    saveCompanyProfile({
      name: draftCompanyName.trim(),
      address: draftCompanyAddress,
      phone: draftCompanyPhone.trim(),
      email: draftCompanyEmail.trim(),
      nameUrdu: draftCompanyNameUrdu.trim(),
      addressUrdu: draftCompanyAddressUrdu,
    });

    saveInvoicePrintSettings({
      locale: draftPrintLocale,
      urduLabelOverrides: draftUrduLabelOverrides,
    });

    window.electron.store.set(
      BLOCK_SAVE_WHEN_SPLIT_TYPED_ACCOUNT_MISSING_KEY,
      !allowSaveWhenSplitTypedAccountMissing,
    );

    toast({
      description: 'Settings saved',
      variant: 'success',
    });
  }, [
    allowSaveWhenSplitTypedAccountMissing,
    debitCreditDefaultLabel,
    saveCompanyProfile,
    draftCompanyName,
    draftCompanyAddress,
    draftCompanyPhone,
    draftCompanyEmail,
    draftCompanyNameUrdu,
    draftCompanyAddressUrdu,
    saveInvoicePrintSettings,
    draftPrintLocale,
    draftUrduLabelOverrides,
  ]);

  return (
    <div>
      <div className="flex flex-col gap-4 mb-4">
        <div className="flex flex-col gap-2">
          <h1 className="self-center text-3xl font-bold">Settings</h1>
          <Separator />
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-medium">General</h2>
          <Separator />
        </div>
      </div>
      <p className="mb-2">
        Default label when <i>Debit</i> or <i>Credit</i> amount is 0:
      </p>
      <p className="text-xs text-muted-foreground mb-4">
        This only changes how zero amounts are displayed in New Journal debit /
        credit inputs. It does not change stored values, exports, or printing.
      </p>
      <RadioGroup
        value={
          defaultLabels.includes(debitCreditDefaultLabel)
            ? debitCreditDefaultLabel
            : 'se'
        }
        className="gap-2"
        onValueChange={setDebitCreditDefaultLabel}
      >
        <div className="flex flex-col gap-5">
          {defaultLabels.map((label) => (
            <div className="flex items-center space-x-2" key={label}>
              <RadioGroupItem value={label} id={label} />
              <Label htmlFor={label}>{label}</Label>
            </div>
          ))}
        </div>
        <div className="flex items-center space-x-2 -mt-2">
          <RadioGroupItem value="se" id="se" />
          <div className="flex flex-col pt-2">
            <Input
              type="text"
              placeholder="Something else"
              aria-label="ekjn"
              value={
                defaultLabels.concat('se').includes(debitCreditDefaultLabel)
                  ? ''
                  : debitCreditDefaultLabel
              }
              maxLength={1}
              onChange={(e) => setDebitCreditDefaultLabel(e.target.value)}
              className="w-[150%] mb-0"
              disabled={defaultLabels.includes(debitCreditDefaultLabel)}
            />
            <Label htmlFor="se" className="text-xs text-gray-400">
              Only 1 letter is allowed
            </Label>
          </div>
        </div>
      </RadioGroup>

      <div className="flex flex-col gap-2 mt-8">
        <h2 className="text-2xl font-medium">Company Profile</h2>
        <Separator />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="companyProfileName">Company name</Label>
          <Input
            id="companyProfileName"
            value={draftCompanyName}
            placeholder="e.g., ABC Traders"
            onChange={(e) => setDraftCompanyName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="companyProfileNameUrdu">Company name (Urdu)</Label>
          <Input
            id="companyProfileNameUrdu"
            value={draftCompanyNameUrdu}
            dir="rtl"
            lang="ur"
            placeholder="اردو نام برائے پرنٹ"
            onChange={(e) => setDraftCompanyNameUrdu(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="companyProfilePhone">Phone</Label>
          <Input
            id="companyProfilePhone"
            value={draftCompanyPhone}
            placeholder="e.g., +92-..."
            onChange={(e) => setDraftCompanyPhone(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="companyProfileEmail">Email</Label>
          <Input
            id="companyProfileEmail"
            value={draftCompanyEmail}
            placeholder="e.g., accounts@company.com"
            onChange={(e) => setDraftCompanyEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2 md:col-span-2">
          <Label htmlFor="companyProfileAddress">Address</Label>
          <Input
            id="companyProfileAddress"
            value={draftCompanyAddress}
            placeholder="e.g., Street, Area, City"
            onChange={(e) => setDraftCompanyAddress(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2 md:col-span-2">
          <Label htmlFor="companyProfileAddressUrdu">Address (Urdu)</Label>
          <Input
            id="companyProfileAddressUrdu"
            value={draftCompanyAddressUrdu}
            dir="rtl"
            lang="ur"
            placeholder="اردو پتہ برائے پرنٹ"
            onChange={(e) => setDraftCompanyAddressUrdu(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-8">
        <h2 className="text-2xl font-medium">New Invoice</h2>
        <Separator />
      </div>
      <div className="flex items-start gap-3 mt-4 max-w-xl">
        <Checkbox
          id="allowSaveWhenSplitTypedAccountMissing"
          checked={allowSaveWhenSplitTypedAccountMissing}
          onCheckedChange={(v) =>
            setAllowSaveWhenSplitTypedAccountMissing(v === true)
          }
          className="mt-1"
        />
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="allowSaveWhenSplitTypedAccountMissing"
            className="font-normal cursor-pointer"
          >
            Allow saving when typed customer account is missing
          </Label>
          <p className="text-xs text-muted-foreground">
            Off by default: on New Invoice (sale, single customer, split by item
            type), Save is blocked while a line still needs a suffixed account
            that does not exist. Turn this on only to save a draft without
            creating those accounts first; turn it off again for strict
            blocking.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-8">
        <h2 className="text-2xl font-medium">Invoice Print</h2>
        <Separator />
      </div>
      <div className="mt-4 max-w-xl">
        <p className="mb-2 text-sm">Printed invoice language</p>
        <RadioGroup
          value={draftPrintLocale}
          className="gap-3"
          onValueChange={(v) => setDraftPrintLocale(v as InvoicePrintLocale)}
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="en" id="printLocaleEn" />
            <Label
              htmlFor="printLocaleEn"
              className="font-normal cursor-pointer"
            >
              English (left-to-right)
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="ur" id="printLocaleUr" />
            <Label
              htmlFor="printLocaleUr"
              className="font-normal cursor-pointer"
            >
              Urdu (right-to-left)
            </Label>
          </div>
        </RadioGroup>
        <p className="text-xs text-muted-foreground mt-2">
          Urdu mode mirrors the print layout, translates labels and amount-in-
          words, and uses company/account Urdu fields when filled (otherwise
          falls back to English). Item codes and numbers stay Latin digits.
        </p>

        <div className="mt-6 border rounded-md">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm font-medium hover:bg-muted/50"
            onClick={() => setUrduLabelsExpanded((open) => !open)}
            aria-expanded={urduLabelsExpanded}
          >
            {urduLabelsExpanded ? (
              <ChevronDown size={16} className="shrink-0" />
            ) : (
              <ChevronRight size={16} className="shrink-0" />
            )}
            Urdu print labels
          </button>
          {urduLabelsExpanded ? (
            <div className="border-t px-3 pb-3 pt-2 space-y-3">
              <p className="text-xs text-muted-foreground">
                Have a native speaker review before production. Leave a field
                empty to keep the built-in default.
              </p>
              <div className="grid grid-cols-1 gap-3">
                {INVOICE_PRINT_LABEL_KEYS.map((key) => (
                  <div className="flex flex-col gap-1.5" key={key}>
                    <Label
                      htmlFor={`urduPrintLabel-${key}`}
                      className="font-normal"
                    >
                      {INVOICE_PRINT_LABEL_TITLES[key]}
                    </Label>
                    <Input
                      id={`urduPrintLabel-${key}`}
                      dir="rtl"
                      lang="ur"
                      value={draftUrduLabelOverrides[key] ?? ''}
                      placeholder={invoicePrintDefaults.urduLabels[key]}
                      onChange={(e) =>
                        handleUrduLabelChange(key, e.target.value)
                      }
                    />
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetUrduLabels}
              >
                Reset Urdu labels to defaults
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-8">
        <h2 className="text-2xl font-medium">Publish Catalog</h2>
        <Separator />
      </div>
      <div className="mt-4 mb-24">
        <PublishSettings />
      </div>

      <div className="fixed bottom-6 left-0 right-0 flex justify-end px-6">
        <Button variant="default" onClick={() => handleSaveSettings()}>
          Save
        </Button>
      </div>
    </div>
  );
};

export default SettingsPage;
