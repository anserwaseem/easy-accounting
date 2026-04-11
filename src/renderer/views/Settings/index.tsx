import { Separator } from 'renderer/shad/ui/separator';
import { RadioGroup, RadioGroupItem } from 'renderer/shad/ui/radio-group';
import { Label } from 'renderer/shad/ui/label';
import { Input } from 'renderer/shad/ui/input';
import { useCallback, useState } from 'react';
import { Button } from 'renderer/shad/ui/button';
import { toast } from 'renderer/shad/ui/use-toast';
import { Checkbox } from '@/renderer/shad/ui/checkbox';
import { BLOCK_SAVE_WHEN_SPLIT_TYPED_ACCOUNT_MISSING_KEY } from '@/renderer/lib/invoiceBehaviorStore';
import { useCompanyProfile, useInvoicePrintSettings } from '@/renderer/hooks';

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

  const {
    settings: invoicePrintSettings,
    saveInvoicePrintSettings,
    defaults,
  } = useInvoicePrintSettings();
  const [draftTotalQuantityLabel, setDraftTotalQuantityLabel] = useState(
    invoicePrintSettings.totalQuantityLabel,
  );

  const [
    allowSaveWhenSplitTypedAccountMissing,
    setAllowSaveWhenSplitTypedAccountMissing,
  ] = useState(
    () =>
      window.electron.store.get(
        BLOCK_SAVE_WHEN_SPLIT_TYPED_ACCOUNT_MISSING_KEY,
      ) === false,
  );

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
    });

    saveInvoicePrintSettings({
      totalQuantityLabel:
        draftTotalQuantityLabel.trim() || defaults.totalQuantityLabel,
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
    saveInvoicePrintSettings,
    draftTotalQuantityLabel,
    defaults.totalQuantityLabel,
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
          <Label htmlFor="companyProfilePhone">Phone</Label>
          <Input
            id="companyProfilePhone"
            value={draftCompanyPhone}
            placeholder="e.g., +92-..."
            onChange={(e) => setDraftCompanyPhone(e.target.value)}
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
        <div className="flex flex-col gap-2">
          <Label htmlFor="companyProfileEmail">Email</Label>
          <Input
            id="companyProfileEmail"
            value={draftCompanyEmail}
            placeholder="e.g., accounts@company.com"
            onChange={(e) => setDraftCompanyEmail(e.target.value)}
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="totalQuantityLabel">Total quantity label</Label>
          <Input
            id="totalQuantityLabel"
            value={draftTotalQuantityLabel}
            placeholder={defaults.totalQuantityLabel}
            onChange={(e) => setDraftTotalQuantityLabel(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Shown above the total quantity row on printed invoices.
          </p>
        </div>
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
