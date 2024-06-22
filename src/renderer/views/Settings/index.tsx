import { Separator } from 'renderer/shad/ui/separator';
import { RadioGroup, RadioGroupItem } from 'renderer/shad/ui/radio-group';
import { Label } from 'renderer/shad/ui/label';
import { Input } from 'renderer/shad/ui/input';
import { useCallback, useState } from 'react';
import { Button } from 'renderer/shad/ui/button';
import { useToast } from 'renderer/shad/ui/use-toast';

const SettingsPage: React.FC = () => {
  // eslint-disable-next-line no-console
  console.log('Settings page');
  const defaultLabels = [' ', '0', '-', 'X'];
  const [debitCreditDefaultLabel, setDebitCreditDefaultLabel] = useState<
    (typeof defaultLabels)[number]
  >(window.electron.store.get('debitCreditDefaultLabel') ?? defaultLabels[0]);

  const { toast } = useToast();

  const handleSaveSettings = useCallback(() => {
    window.electron.store.set(
      'debitCreditDefaultLabel',
      debitCreditDefaultLabel,
    );

    toast({
      description: 'Settings saved',
    });
  }, [debitCreditDefaultLabel, toast]);

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

      <div className="flex fixed bottom-6">
        <Button variant="default" onClick={() => handleSaveSettings()}>
          Save
        </Button>
      </div>
    </div>
  );
};

export default SettingsPage;
