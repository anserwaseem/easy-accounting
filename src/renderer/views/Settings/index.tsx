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
import {
  EXAMPLE_INVOICE_PRINT_NOTE_EN,
  EXAMPLE_INVOICE_PRINT_NOTE_UR,
} from '@/renderer/lib/invoicePrint/notes';
import { useCompanyProfile, useInvoicePrintSettings } from '@/renderer/hooks';
import PublishSettings from './PublishSettings';

interface InvoicePrintLabelsAccordionProps {
  title: string;
  hint: string;
  resetLabel: string;
  expanded: boolean;
  onToggle: () => void;
  overrides: Partial<InvoicePrintLabels>;
  placeholders: InvoicePrintLabels;
  inputDir?: 'ltr' | 'rtl';
  inputLang?: string;
  idPrefix: string;
  onChange: (key: InvoicePrintLabelKey, value: string) => void;
  onReset: () => void;
}

const InvoicePrintLabelsAccordion: React.FC<
  InvoicePrintLabelsAccordionProps
> = ({
  title,
  hint,
  resetLabel,
  expanded,
  onToggle,
  overrides,
  placeholders,
  inputDir,
  inputLang,
  idPrefix,
  onChange,
  onReset,
}: InvoicePrintLabelsAccordionProps) => (
  <div className="mt-6 border rounded-md">
    <button
      type="button"
      className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm font-medium hover:bg-muted/50"
      onClick={onToggle}
      aria-expanded={expanded}
    >
      {expanded ? (
        <ChevronDown size={16} className="shrink-0" />
      ) : (
        <ChevronRight size={16} className="shrink-0" />
      )}
      {title}
    </button>
    {expanded ? (
      <div className="border-t px-3 pb-3 pt-2 space-y-3">
        <p className="text-xs text-muted-foreground">{hint}</p>
        <div className="grid grid-cols-1 gap-3">
          {INVOICE_PRINT_LABEL_KEYS.map((key) => (
            <div className="flex flex-col gap-1.5" key={key}>
              <Label htmlFor={`${idPrefix}-${key}`} className="font-normal">
                {INVOICE_PRINT_LABEL_TITLES[key]}
              </Label>
              <Input
                id={`${idPrefix}-${key}`}
                dir={inputDir}
                lang={inputLang}
                value={overrides[key] ?? ''}
                placeholder={placeholders[key]}
                onChange={(e) => onChange(key, e.target.value)}
              />
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onReset}>
          {resetLabel}
        </Button>
      </div>
    ) : null}
  </div>
);

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
  const [draftCompanyWhatsapp, setDraftCompanyWhatsapp] = useState(
    companyProfile.whatsapp,
  );
  const [draftCompanyWebsite, setDraftCompanyWebsite] = useState(
    companyProfile.website,
  );
  const [draftCompanyPrintNote, setDraftCompanyPrintNote] = useState(
    companyProfile.printNote,
  );
  const [draftCompanyPrintNoteUrdu, setDraftCompanyPrintNoteUrdu] = useState(
    companyProfile.printNoteUrdu,
  );

  const {
    settings: invoicePrintSettings,
    saveInvoicePrintSettings,
    defaults: invoicePrintDefaults,
  } = useInvoicePrintSettings();
  const [draftPrintLocale, setDraftPrintLocale] = useState<InvoicePrintLocale>(
    invoicePrintSettings.locale,
  );
  const [draftShowPartyBalances, setDraftShowPartyBalances] = useState(
    invoicePrintSettings.showPartyBalances,
  );
  const [draftShowAgent, setDraftShowAgent] = useState(
    invoicePrintSettings.showAgent,
  );
  const [draftEnglishLabelOverrides, setDraftEnglishLabelOverrides] = useState<
    Partial<InvoicePrintLabels>
  >(() => ({ ...invoicePrintSettings.englishLabelOverrides }));
  const [draftUrduLabelOverrides, setDraftUrduLabelOverrides] = useState<
    Partial<InvoicePrintLabels>
  >(() => ({ ...invoicePrintSettings.urduLabelOverrides }));
  const [englishLabelsExpanded, setEnglishLabelsExpanded] = useState(false);
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

  const handleEnglishLabelChange = useCallback(
    (key: InvoicePrintLabelKey, value: string) => {
      setDraftEnglishLabelOverrides((prev) => {
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

  const handleResetEnglishLabels = useCallback(() => {
    setDraftEnglishLabelOverrides({});
  }, []);

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
      whatsapp: draftCompanyWhatsapp.trim(),
      website: draftCompanyWebsite.trim(),
      printNote: draftCompanyPrintNote,
      printNoteUrdu: draftCompanyPrintNoteUrdu,
    });

    saveInvoicePrintSettings({
      locale: draftPrintLocale,
      englishLabelOverrides: draftEnglishLabelOverrides,
      urduLabelOverrides: draftUrduLabelOverrides,
      showPartyBalances: draftShowPartyBalances,
      showAgent: draftShowAgent,
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
    draftCompanyWhatsapp,
    draftCompanyWebsite,
    draftCompanyPrintNote,
    draftCompanyPrintNoteUrdu,
    saveInvoicePrintSettings,
    draftPrintLocale,
    draftShowPartyBalances,
    draftShowAgent,
    draftEnglishLabelOverrides,
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
        <div className="flex flex-col gap-2">
          <Label htmlFor="companyProfileWhatsapp">WhatsApp</Label>
          <Input
            id="companyProfileWhatsapp"
            value={draftCompanyWhatsapp}
            placeholder="e.g., 03xx-xxxxxxx"
            onChange={(e) => setDraftCompanyWhatsapp(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="companyProfileWebsite">Website</Label>
          <Input
            id="companyProfileWebsite"
            value={draftCompanyWebsite}
            placeholder="e.g., https://example.com"
            onChange={(e) => setDraftCompanyWebsite(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2 md:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="companyProfilePrintNote">Invoice print note</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              disabled={draftCompanyPrintNote === EXAMPLE_INVOICE_PRINT_NOTE_EN}
              onClick={() =>
                setDraftCompanyPrintNote(EXAMPLE_INVOICE_PRINT_NOTE_EN)
              }
            >
              Use default
            </Button>
          </div>
          <textarea
            id="companyProfilePrintNote"
            value={draftCompanyPrintNote}
            placeholder="Optional terms on sale invoices"
            onChange={(e) => setDraftCompanyPrintNote(e.target.value)}
            rows={3}
            className="flex min-h-[4.5rem] w-full rounded-md border border-input bg-background my-2 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <div className="flex flex-col gap-2 md:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="companyProfilePrintNoteUrdu">
              Invoice print note (Urdu)
            </Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              disabled={
                draftCompanyPrintNoteUrdu === EXAMPLE_INVOICE_PRINT_NOTE_UR
              }
              onClick={() =>
                setDraftCompanyPrintNoteUrdu(EXAMPLE_INVOICE_PRINT_NOTE_UR)
              }
            >
              Use default
            </Button>
          </div>
          <textarea
            id="companyProfilePrintNoteUrdu"
            value={draftCompanyPrintNoteUrdu}
            dir="rtl"
            lang="ur"
            placeholder="اختیاری نوٹ برائے سیل بل"
            onChange={(e) => setDraftCompanyPrintNoteUrdu(e.target.value)}
            rows={3}
            className="flex min-h-[4.5rem] w-full rounded-md border border-input bg-background my-2 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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

        <div className="flex items-start gap-3 mt-6">
          <Checkbox
            id="printShowPartyBalances"
            checked={draftShowPartyBalances}
            onCheckedChange={(v) => setDraftShowPartyBalances(v === true)}
            className="mt-1"
          />
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="printShowPartyBalances"
              className="font-normal cursor-pointer"
            >
              Show previous and new balance
            </Label>
            <p className="text-xs text-muted-foreground">
              Prints سابقہ بقایا / نیا بقایا (previous and new balance) for
              named parties. Override on the print screen for a single invoice.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 mt-6">
          <Checkbox
            id="printShowAgent"
            checked={draftShowAgent}
            onCheckedChange={(v) => setDraftShowAgent(v === true)}
            className="mt-1"
          />
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="printShowAgent"
              className="font-normal cursor-pointer"
            >
              Show marketing representative / custom head
            </Label>
            <p className="text-xs text-muted-foreground">
              Prints the chart head (marketing representative) next to the party
              name. Override on the print screen for a single invoice.
            </p>
          </div>
        </div>

        <InvoicePrintLabelsAccordion
          idPrefix="enPrintLabel"
          title="English print labels"
          hint="Leave a field empty to keep the built-in default."
          resetLabel="Reset English labels to defaults"
          expanded={englishLabelsExpanded}
          onToggle={() => setEnglishLabelsExpanded((open) => !open)}
          overrides={draftEnglishLabelOverrides}
          placeholders={invoicePrintDefaults.englishLabels}
          onChange={handleEnglishLabelChange}
          onReset={handleResetEnglishLabels}
        />
        <InvoicePrintLabelsAccordion
          idPrefix="urduPrintLabel"
          title="Urdu print labels"
          hint="Have a native speaker review before production. Leave a field empty to keep the built-in default."
          resetLabel="Reset Urdu labels to defaults"
          expanded={urduLabelsExpanded}
          onToggle={() => setUrduLabelsExpanded((open) => !open)}
          overrides={draftUrduLabelOverrides}
          placeholders={invoicePrintDefaults.urduLabels}
          inputDir="rtl"
          inputLang="ur"
          onChange={handleUrduLabelChange}
          onReset={handleResetUrduLabels}
        />
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
