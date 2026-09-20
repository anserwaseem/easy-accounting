import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from 'renderer/shad/ui/input';
import { Label } from 'renderer/shad/ui/label';
import { Button } from 'renderer/shad/ui/button';
import { toast } from 'renderer/shad/ui/use-toast';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from 'renderer/shad/ui/card';

interface BackupConfigView {
  supabaseUrl: string;
  hasAnonKey: boolean;
  encryptionAvailable: boolean;
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  type?: string;
}

const Field: React.FC<FieldProps> = ({
  id,
  label,
  value,
  onChange,
  hint,
  placeholder,
  type,
}: FieldProps) => (
  <div className="flex flex-col gap-2">
    <Label htmlFor={id}>{label}</Label>
    <Input
      id={id}
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
    {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
  </div>
);

const EMPTY_CONFIG: BackupConfigView = {
  supabaseUrl: '',
  hasAnonKey: false,
  encryptionAvailable: false,
};

/**
 * Desktop cloud-backup destination. Local backups still work with this
 * empty; cloud upload needs a supabase project url + anon key stored on
 * this machine (anon key never leaves main / is never synced).
 */
const BackupSettings: React.FC = () => {
  const [config, setConfig] = useState<BackupConfigView>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [anonKeyTouched, setAnonKeyTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const next = await window.electron.getBackupConfig();
    setConfig(next);
    setSupabaseUrl(next.supabaseUrl);
    setAnonKey('');
    setAnonKeyTouched(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isDirty = useMemo(
    () => anonKeyTouched || supabaseUrl !== config.supabaseUrl,
    [anonKeyTouched, supabaseUrl, config.supabaseUrl],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const next = await window.electron.saveBackupConfig({
        supabaseUrl,
        ...(anonKeyTouched ? { anonKey } : {}),
      });
      setConfig(next);
      setSupabaseUrl(next.supabaseUrl);
      setAnonKey('');
      setAnonKeyTouched(false);
      toast({
        description: next.hasAnonKey
          ? 'Cloud backup settings saved.'
          : 'Cloud backup url saved. Add an anon key to enable cloud uploads.',
      });
    } catch (error) {
      toast({
        description: `Could not save backup settings: ${
          (error as Error)?.message ?? 'unknown error'
        }`,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [supabaseUrl, anonKey, anonKeyTouched]);

  if (loading) return <p className="text-sm">Loading backup settings…</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cloud backup</CardTitle>
        <CardDescription>
          Optional supabase project used to upload this machine&apos;s database
          backups into the `easy-accounting-backups` bucket (created by
          `supabase/setup.sql`). Local backups still run without it. The anon
          key is stored in the system keychain and never synced.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!config.encryptionAvailable && (
          <p className="text-sm text-destructive">
            Secure storage is unavailable on this system, so the anon key cannot
            be saved.
          </p>
        )}
        <Field
          id="backup-supabase-url"
          label="Project URL"
          placeholder="https://xxxx.supabase.co"
          value={supabaseUrl}
          onChange={setSupabaseUrl}
          hint="Same shape as the sync project URL. Can be a different project."
        />
        <Field
          id="backup-anon-key"
          label="Anon public API key"
          type="password"
          placeholder={config.hasAnonKey ? '••••••••' : ''}
          value={anonKey}
          onChange={(value) => {
            setAnonKey(value);
            setAnonKeyTouched(true);
          }}
          hint={
            config.hasAnonKey
              ? 'A key is saved in the system keychain. Type a new one to replace it.'
              : 'Stored in the system keychain, never in the app files.'
          }
        />
        <div>
          <Button
            type="button"
            disabled={!isDirty || saving}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : 'Save backup settings'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default BackupSettings;
