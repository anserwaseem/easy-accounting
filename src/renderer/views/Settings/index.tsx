import { useCallback, useEffect, useMemo, useState } from 'react';
import isEqual from 'lodash/isEqual';
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Info,
  Languages,
  Printer,
  RotateCcw,
  Save,
  Sliders,
} from 'lucide-react';
import { Button } from '@/renderer/shad/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/renderer/shad/ui/card';
import { Input } from '@/renderer/shad/ui/input';
import { Label } from '@/renderer/shad/ui/label';
import { RadioGroup, RadioGroupItem } from '@/renderer/shad/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/renderer/shad/ui/select';
import { Separator } from '@/renderer/shad/ui/separator';
import { Switch } from '@/renderer/shad/ui/switch';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/renderer/shad/ui/tabs';
import { toast } from '@/renderer/shad/ui/use-toast';
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
  <div className="mt-4 border rounded-md">
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {INVOICE_PRINT_LABEL_KEYS.map((labelKey) => (
            <div className="flex flex-col gap-1.5" key={labelKey}>
              <Label
                htmlFor={`${idPrefix}-${labelKey}`}
                className="font-normal text-xs"
              >
                {INVOICE_PRINT_LABEL_TITLES[labelKey]}
              </Label>
              <Input
                id={`${idPrefix}-${labelKey}`}
                dir={inputDir}
                lang={inputLang}
                value={overrides[labelKey] ?? ''}
                placeholder={placeholders[labelKey]}
                onChange={(e) => onChange(labelKey, e.target.value)}
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

const DEFAULT_LABELS = [' ', '0', '-', 'X'];

const SettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState('profile');
  const [isSavedRecently, setIsSavedRecently] = useState(false);

  // company profile
  const { profile: companyProfile, saveCompanyProfile } = useCompanyProfile();
  const [draftCompanyName, setDraftCompanyName] = useState(companyProfile.name);
  const [draftCompanyNameUrdu, setDraftCompanyNameUrdu] = useState(
    companyProfile.nameUrdu,
  );
  const [draftCompanyPhone, setDraftCompanyPhone] = useState(
    companyProfile.phone,
  );
  const [draftCompanyEmail, setDraftCompanyEmail] = useState(
    companyProfile.email,
  );
  const [draftCompanyWhatsapp, setDraftCompanyWhatsapp] = useState(
    companyProfile.whatsapp,
  );
  const [draftCompanyWebsite, setDraftCompanyWebsite] = useState(
    companyProfile.website,
  );
  const [draftCompanyAddress, setDraftCompanyAddress] = useState(
    companyProfile.address,
  );
  const [draftCompanyAddressUrdu, setDraftCompanyAddressUrdu] = useState(
    companyProfile.addressUrdu,
  );
  const [draftCompanyPrintNote, setDraftCompanyPrintNote] = useState(
    companyProfile.printNote,
  );
  const [draftCompanyPrintNoteUrdu, setDraftCompanyPrintNoteUrdu] = useState(
    companyProfile.printNoteUrdu,
  );

  // invoice print settings
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

  // general debit/credit zero label
  const [savedDebitCreditDefaultLabel, setSavedDebitCreditDefaultLabel] =
    useState<string>(
      () =>
        window.electron.store.get('debitCreditDefaultLabel') ??
        DEFAULT_LABELS[0],
    );
  const [draftDebitCreditDefaultLabel, setDraftDebitCreditDefaultLabel] =
    useState<string>(
      () =>
        window.electron.store.get('debitCreditDefaultLabel') ??
        DEFAULT_LABELS[0],
    );

  // accounting validation rules: strict split account requirement
  const [savedStrictSplitRule, setSavedStrictSplitRule] = useState<boolean>(
    () =>
      window.electron.store.get(
        BLOCK_SAVE_WHEN_SPLIT_TYPED_ACCOUNT_MISSING_KEY,
      ) !== false,
  );
  const [draftStrictSplitRule, setDraftStrictSplitRule] = useState<boolean>(
    () =>
      window.electron.store.get(
        BLOCK_SAVE_WHEN_SPLIT_TYPED_ACCOUNT_MISSING_KEY,
      ) !== false,
  );

  // sync draft state when persistent store/hooks update
  useEffect(() => {
    setDraftCompanyName(companyProfile.name);
    setDraftCompanyNameUrdu(companyProfile.nameUrdu);
    setDraftCompanyPhone(companyProfile.phone);
    setDraftCompanyEmail(companyProfile.email);
    setDraftCompanyWhatsapp(companyProfile.whatsapp);
    setDraftCompanyWebsite(companyProfile.website);
    setDraftCompanyAddress(companyProfile.address);
    setDraftCompanyAddressUrdu(companyProfile.addressUrdu);
    setDraftCompanyPrintNote(companyProfile.printNote);
    setDraftCompanyPrintNoteUrdu(companyProfile.printNoteUrdu);
  }, [companyProfile]);

  useEffect(() => {
    setDraftPrintLocale(invoicePrintSettings.locale);
    setDraftShowPartyBalances(invoicePrintSettings.showPartyBalances);
    setDraftShowAgent(invoicePrintSettings.showAgent);
    setDraftEnglishLabelOverrides({
      ...invoicePrintSettings.englishLabelOverrides,
    });
    setDraftUrduLabelOverrides({ ...invoicePrintSettings.urduLabelOverrides });
  }, [invoicePrintSettings]);

  // dirty state check
  const isDirty = useMemo(() => {
    const profileDirty =
      draftCompanyName !== companyProfile.name ||
      draftCompanyNameUrdu !== companyProfile.nameUrdu ||
      draftCompanyPhone !== companyProfile.phone ||
      draftCompanyEmail !== companyProfile.email ||
      draftCompanyWhatsapp !== companyProfile.whatsapp ||
      draftCompanyWebsite !== companyProfile.website ||
      draftCompanyAddress !== companyProfile.address ||
      draftCompanyAddressUrdu !== companyProfile.addressUrdu ||
      draftCompanyPrintNote !== companyProfile.printNote ||
      draftCompanyPrintNoteUrdu !== companyProfile.printNoteUrdu;

    const invoiceDirty =
      draftPrintLocale !== invoicePrintSettings.locale ||
      draftShowPartyBalances !== invoicePrintSettings.showPartyBalances ||
      draftShowAgent !== invoicePrintSettings.showAgent ||
      !isEqual(
        draftEnglishLabelOverrides,
        invoicePrintSettings.englishLabelOverrides,
      ) ||
      !isEqual(
        draftUrduLabelOverrides,
        invoicePrintSettings.urduLabelOverrides,
      );

    const generalDirty =
      draftDebitCreditDefaultLabel !== savedDebitCreditDefaultLabel;
    const rulesDirty = draftStrictSplitRule !== savedStrictSplitRule;

    return profileDirty || invoiceDirty || generalDirty || rulesDirty;
  }, [
    draftCompanyName,
    draftCompanyNameUrdu,
    draftCompanyPhone,
    draftCompanyEmail,
    draftCompanyWhatsapp,
    draftCompanyWebsite,
    draftCompanyAddress,
    draftCompanyAddressUrdu,
    draftCompanyPrintNote,
    draftCompanyPrintNoteUrdu,
    companyProfile,
    draftPrintLocale,
    draftShowPartyBalances,
    draftShowAgent,
    draftEnglishLabelOverrides,
    draftUrduLabelOverrides,
    invoicePrintSettings,
    draftDebitCreditDefaultLabel,
    savedDebitCreditDefaultLabel,
    draftStrictSplitRule,
    savedStrictSplitRule,
  ]);

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

  const handleReset = useCallback(() => {
    setDraftCompanyName(companyProfile.name);
    setDraftCompanyNameUrdu(companyProfile.nameUrdu);
    setDraftCompanyPhone(companyProfile.phone);
    setDraftCompanyEmail(companyProfile.email);
    setDraftCompanyWhatsapp(companyProfile.whatsapp);
    setDraftCompanyWebsite(companyProfile.website);
    setDraftCompanyAddress(companyProfile.address);
    setDraftCompanyAddressUrdu(companyProfile.addressUrdu);
    setDraftCompanyPrintNote(companyProfile.printNote);
    setDraftCompanyPrintNoteUrdu(companyProfile.printNoteUrdu);

    setDraftPrintLocale(invoicePrintSettings.locale);
    setDraftShowPartyBalances(invoicePrintSettings.showPartyBalances);
    setDraftShowAgent(invoicePrintSettings.showAgent);
    setDraftEnglishLabelOverrides({
      ...invoicePrintSettings.englishLabelOverrides,
    });
    setDraftUrduLabelOverrides({ ...invoicePrintSettings.urduLabelOverrides });

    setDraftDebitCreditDefaultLabel(savedDebitCreditDefaultLabel);
    setDraftStrictSplitRule(savedStrictSplitRule);
  }, [
    companyProfile,
    invoicePrintSettings,
    savedDebitCreditDefaultLabel,
    savedStrictSplitRule,
  ]);

  const handleSaveSettings = useCallback(() => {
    window.electron.store.set(
      'debitCreditDefaultLabel',
      draftDebitCreditDefaultLabel,
    );
    setSavedDebitCreditDefaultLabel(draftDebitCreditDefaultLabel);

    saveCompanyProfile({
      name: draftCompanyName.trim(),
      nameUrdu: draftCompanyNameUrdu.trim(),
      phone: draftCompanyPhone.trim(),
      email: draftCompanyEmail.trim(),
      whatsapp: draftCompanyWhatsapp.trim(),
      website: draftCompanyWebsite.trim(),
      address: draftCompanyAddress,
      addressUrdu: draftCompanyAddressUrdu,
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
      draftStrictSplitRule,
    );
    setSavedStrictSplitRule(draftStrictSplitRule);

    setIsSavedRecently(true);
    setTimeout(() => setIsSavedRecently(false), 2500);

    toast({
      description: 'Settings saved successfully',
      variant: 'success',
    });
  }, [
    draftDebitCreditDefaultLabel,
    saveCompanyProfile,
    draftCompanyName,
    draftCompanyNameUrdu,
    draftCompanyPhone,
    draftCompanyEmail,
    draftCompanyWhatsapp,
    draftCompanyWebsite,
    draftCompanyAddress,
    draftCompanyAddressUrdu,
    draftCompanyPrintNote,
    draftCompanyPrintNoteUrdu,
    saveInvoicePrintSettings,
    draftPrintLocale,
    draftShowPartyBalances,
    draftShowAgent,
    draftEnglishLabelOverrides,
    draftUrduLabelOverrides,
    draftStrictSplitRule,
  ]);

  return (
    <div className="flex flex-col min-h-full bg-background text-foreground pb-20">
      {/* Header */}
      <div className="border-b py-5">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage company metadata, invoice templates, validation rules, and sync
          options.
        </p>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto py-6">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-6"
        >
          <TabsList className="grid grid-cols-4 w-full max-w-2xl">
            <TabsTrigger value="profile" className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              <span>Company</span>
            </TabsTrigger>
            <TabsTrigger value="invoicing" className="flex items-center gap-2">
              <Printer className="w-4 h-4" />
              <span>Invoicing</span>
            </TabsTrigger>
            <TabsTrigger value="rules" className="flex items-center gap-2">
              <Sliders className="w-4 h-4" />
              <span>Rules</span>
            </TabsTrigger>
            <TabsTrigger value="sync" className="flex items-center gap-2">
              <Cloud className="w-4 h-4" />
              <span>Sync</span>
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Company Profile & General */}
          <TabsContent value="profile" className="space-y-6 max-w-4xl">
            <Card>
              <CardHeader>
                <CardTitle>Company Details</CardTitle>
                <CardDescription>
                  This information appears on generated receipts and invoice
                  headers.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="companyName">Business Name (English)</Label>
                    <Input
                      id="companyName"
                      value={draftCompanyName}
                      onChange={(e) => setDraftCompanyName(e.target.value)}
                      placeholder="e.g. Al-Madina Traders"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="companyNameUrdu">
                        Business Name (Urdu / اردو)
                      </Label>
                      <span className="text-xs text-muted-foreground">RTL</span>
                    </div>
                    <Input
                      id="companyNameUrdu"
                      dir="rtl"
                      lang="ur"
                      className="font-serif text-right"
                      value={draftCompanyNameUrdu}
                      onChange={(e) => setDraftCompanyNameUrdu(e.target.value)}
                      placeholder="اردو نام برائے پرنٹ"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="companyPhone">Phone Number</Label>
                    <Input
                      id="companyPhone"
                      value={draftCompanyPhone}
                      onChange={(e) => setDraftCompanyPhone(e.target.value)}
                      placeholder="e.g. +92-..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="companyWhatsapp">WhatsApp</Label>
                    <Input
                      id="companyWhatsapp"
                      value={draftCompanyWhatsapp}
                      onChange={(e) => setDraftCompanyWhatsapp(e.target.value)}
                      placeholder="e.g. 03xx-xxxxxxx"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="companyEmail">Email Address</Label>
                    <Input
                      id="companyEmail"
                      type="email"
                      value={draftCompanyEmail}
                      onChange={(e) => setDraftCompanyEmail(e.target.value)}
                      placeholder="e.g. accounts@company.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="companyWebsite">Website</Label>
                    <Input
                      id="companyWebsite"
                      value={draftCompanyWebsite}
                      onChange={(e) => setDraftCompanyWebsite(e.target.value)}
                      placeholder="e.g. https://example.com"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="companyAddress">
                    Physical Address (English)
                  </Label>
                  <Input
                    id="companyAddress"
                    value={draftCompanyAddress}
                    onChange={(e) => setDraftCompanyAddress(e.target.value)}
                    placeholder="e.g. Street, Area, City"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label htmlFor="companyAddressUrdu">
                      Physical Address (Urdu / اردو)
                    </Label>
                    <span className="text-xs text-muted-foreground">RTL</span>
                  </div>
                  <Input
                    id="companyAddressUrdu"
                    dir="rtl"
                    lang="ur"
                    className="font-serif text-right"
                    value={draftCompanyAddressUrdu}
                    onChange={(e) => setDraftCompanyAddressUrdu(e.target.value)}
                    placeholder="اردو پتہ برائے پرنٹ"
                  />
                </div>

                <Separator className="my-4" />

                <div className="space-y-4">
                  <h3 className="text-sm font-semibold">
                    Standard Print Notes
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="companyPrintNote">
                        Footer Note (English)
                      </Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 px-2 text-xs"
                        disabled={
                          draftCompanyPrintNote ===
                          EXAMPLE_INVOICE_PRINT_NOTE_EN
                        }
                        onClick={() =>
                          setDraftCompanyPrintNote(
                            EXAMPLE_INVOICE_PRINT_NOTE_EN,
                          )
                        }
                      >
                        Use default
                      </Button>
                    </div>
                    <textarea
                      id="companyPrintNote"
                      value={draftCompanyPrintNote}
                      placeholder="Optional terms on sale invoices"
                      onChange={(e) => setDraftCompanyPrintNote(e.target.value)}
                      rows={3}
                      className="flex min-h-[4.5rem] w-full rounded-md border border-input bg-background my-2 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="companyPrintNoteUrdu">
                          Footer Note (Urdu / اردو)
                        </Label>
                        <span className="text-xs text-muted-foreground">
                          RTL
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 px-2 text-xs"
                        disabled={
                          draftCompanyPrintNoteUrdu ===
                          EXAMPLE_INVOICE_PRINT_NOTE_UR
                        }
                        onClick={() =>
                          setDraftCompanyPrintNoteUrdu(
                            EXAMPLE_INVOICE_PRINT_NOTE_UR,
                          )
                        }
                      >
                        Use default
                      </Button>
                    </div>
                    <textarea
                      id="companyPrintNoteUrdu"
                      dir="rtl"
                      lang="ur"
                      value={draftCompanyPrintNoteUrdu}
                      placeholder="اختیاری نوٹ برائے سیل بل"
                      onChange={(e) =>
                        setDraftCompanyPrintNoteUrdu(e.target.value)
                      }
                      rows={3}
                      className="flex min-h-[4.5rem] w-full rounded-md border border-input bg-background my-2 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-serif text-right"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Journal Display Settings</CardTitle>
                <CardDescription>
                  Configure how zero amounts are formatted in New Journal debit
                  / credit inputs.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <p className="text-sm">
                    Default label when <i>Debit</i> or <i>Credit</i> amount is
                    0:
                  </p>
                  <p className="text-xs text-muted-foreground">
                    This only changes how zero amounts are displayed in New
                    Journal inputs. It does not change stored values, exports,
                    or printing.
                  </p>
                </div>
                <RadioGroup
                  value={
                    DEFAULT_LABELS.includes(draftDebitCreditDefaultLabel)
                      ? draftDebitCreditDefaultLabel
                      : 'custom'
                  }
                  className="gap-3"
                  onValueChange={setDraftDebitCreditDefaultLabel}
                >
                  <div className="flex flex-col gap-3">
                    {DEFAULT_LABELS.map((opt) => (
                      <div className="flex items-center space-x-2" key={opt}>
                        <RadioGroupItem value={opt} id={`zero-label-${opt}`} />
                        <Label
                          htmlFor={`zero-label-${opt}`}
                          className="cursor-pointer font-normal"
                        >
                          {opt === ' ' ? 'Empty space (" ")' : opt}
                        </Label>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center space-x-2 pt-1">
                    <RadioGroupItem value="custom" id="zero-label-custom" />
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        placeholder="Custom symbol"
                        value={
                          DEFAULT_LABELS.concat('custom').includes(
                            draftDebitCreditDefaultLabel,
                          )
                            ? ''
                            : draftDebitCreditDefaultLabel
                        }
                        maxLength={1}
                        onChange={(e) =>
                          setDraftDebitCreditDefaultLabel(e.target.value)
                        }
                        className="w-32 h-8 text-sm"
                        disabled={DEFAULT_LABELS.includes(
                          draftDebitCreditDefaultLabel,
                        )}
                      />
                      <span className="text-xs text-muted-foreground">
                        (Single letter or character)
                      </span>
                    </div>
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 2: Invoicing Settings */}
          <TabsContent value="invoicing" className="space-y-6 max-w-4xl">
            <Card>
              <CardHeader>
                <CardTitle>Invoice Print Layout</CardTitle>
                <CardDescription>
                  Configure printing language, party balance visibility, and
                  label overrides.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5">
                      <Languages className="w-4 h-4 text-muted-foreground" />
                      Print Language Format
                    </Label>
                    <Select
                      value={draftPrintLocale}
                      onValueChange={(val) =>
                        setDraftPrintLocale(val as InvoicePrintLocale)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select Language" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">
                          English (left-to-right)
                        </SelectItem>
                        <SelectItem value="ur">Urdu (right-to-left)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Urdu mode mirrors the print layout, translates labels and
                      amount-in-words, and uses company/account Urdu fields when
                      filled.
                    </p>
                  </div>

                  <div className="flex flex-col justify-center space-y-4 pt-1">
                    <div className="flex items-center justify-between p-3 border rounded-md">
                      <div className="space-y-0.5 pr-2">
                        <Label className="text-sm font-medium">
                          Show Customer Balances
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Prints سابقہ بقایا / نیا بقایا (previous and new
                          balance) for named parties
                        </p>
                      </div>
                      <Switch
                        checked={draftShowPartyBalances}
                        onCheckedChange={setDraftShowPartyBalances}
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 border rounded-md">
                      <div className="space-y-0.5 pr-2">
                        <Label className="text-sm font-medium">
                          Show Sales Agent
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Prints the chart head / marketing representative next
                          to party name
                        </p>
                      </div>
                      <Switch
                        checked={draftShowAgent}
                        onCheckedChange={setDraftShowAgent}
                      />
                    </div>
                  </div>
                </div>

                {/* Print Label Accordions */}
                <div className="space-y-3 pt-2">
                  <h4 className="text-sm font-semibold">
                    Print Label Customization
                  </h4>
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
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 3: System & Accounting Rules */}
          <TabsContent value="rules" className="space-y-6 max-w-4xl">
            <Card>
              <CardHeader>
                <CardTitle>Accounting Validation Rules</CardTitle>
                <CardDescription>
                  Configure entry constraints and transaction validation
                  policies.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg bg-card">
                  <div className="space-y-1 pr-4">
                    <div className="flex items-center gap-2">
                      <Label className="font-medium text-base">
                        Strict Split-Type Account Requirement
                      </Label>
                      <Info className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground max-w-2xl">
                      When enabled (recommended), sale invoices with single
                      customer split by item type are blocked from saving if any
                      line requires a suffixed account that does not exist. Turn
                      off only to save drafts without creating those accounts
                      first.
                    </p>
                  </div>
                  <Switch
                    checked={draftStrictSplitRule}
                    onCheckedChange={setDraftStrictSplitRule}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab 4: Cloud Sync / Publish */}
          <TabsContent value="sync" className="space-y-6 max-w-4xl">
            <PublishSettings />
          </TabsContent>
        </Tabs>
      </div>

      {/* Persistent Bottom Action Bar */}
      {isDirty && (
        <div className="fixed bottom-0 left-0 right-0 border-t bg-background/40 backdrop-blur px-8 py-3.5 flex items-center justify-between z-20 shadow-lg">
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 font-medium">
            <Info className="w-4 h-4" />
            <span>You have unsaved changes.</span>
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="gap-1.5"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveSettings}
              className="gap-1.5"
            >
              <Save className="w-4 h-4" />
              Save Changes
            </Button>
          </div>
        </div>
      )}

      {/* Confirmation feedback */}
      {isSavedRecently && !isDirty && (
        <div className="fixed bottom-4 right-8 bg-primary text-primary-foreground px-4 py-2 rounded-md shadow-lg flex items-center gap-2 text-sm z-30">
          <Check className="w-4 h-4" />
          Settings saved successfully
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
