import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Input } from 'renderer/shad/ui/input';
import { Label } from 'renderer/shad/ui/label';
import { Button } from 'renderer/shad/ui/button';
import { Checkbox } from 'renderer/shad/ui/checkbox';
import { toast } from 'renderer/shad/ui/use-toast';
import {
  usePublishSettings,
  missingPublishConfig,
  type CatalogPreview,
} from '@/renderer/hooks/usePublishSettings';

/** marks a required field label */
const Required: React.FC = () => (
  <span className="text-destructive" aria-hidden>
    {' '}
    *
  </span>
);

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
}

const Field: React.FC<FieldProps> = ({
  id,
  label,
  value,
  onChange,
  hint,
  placeholder,
  required = false,
  type,
}: FieldProps) => (
  <div className="flex flex-col gap-2">
    <Label htmlFor={id}>
      {label}
      {required && <Required />}
    </Label>
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

/**
 * Catalog publishing configuration. Every value is supplied by this
 * installation — nothing is bundled with the app. The secret access key is
 * stored via the OS keychain and is never read back into this screen.
 */
const PublishSettings: React.FC = () => {
  const {
    config,
    priceListNames,
    loading,
    lastResult,
    progress,
    runPublish,
    savePublishConfig,
    previewCatalog,
  } = usePublishSettings();
  const [publishing, setPublishing] = useState(false);

  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('');
  const [bucket, setBucket] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [secretTouched, setSecretTouched] = useState(false);
  const [publicBaseUrl, setPublicBaseUrl] = useState('');
  const [privatePrefix, setPrivatePrefix] = useState('');
  const [publicPrefix, setPublicPrefix] = useState('');
  const [imagesManifestUrl, setImagesManifestUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [publicLists, setPublicLists] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [preview, setPreview] = useState<CatalogPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // hydrate local drafts once the stored config arrives
  useEffect(() => {
    if (loading) return;
    setEndpoint(config.endpoint);
    setRegion(config.region);
    setBucket(config.bucket);
    setAccessKeyId(config.accessKeyId);
    setPublicBaseUrl(config.publicBaseUrl);
    setPrivatePrefix(config.privatePrefix);
    setPublicPrefix(config.publicPrefix);
    setImagesManifestUrl(config.imagesManifestUrl);
    setWebhookUrl(config.webhookUrl);
    setPublicLists(config.publicPriceLists);
  }, [loading, config]);

  // readiness reflects what is typed now, treating a typed secret as present
  const missing = useMemo(
    () =>
      missingPublishConfig({
        endpoint,
        bucket,
        accessKeyId,
        hasSecretAccessKey: config.hasSecretAccessKey || !!secretAccessKey,
        publicPriceLists: publicLists,
      }),
    [
      endpoint,
      bucket,
      accessKeyId,
      config.hasSecretAccessKey,
      secretAccessKey,
      publicLists,
    ],
  );

  const togglePublicList = useCallback((name: string, checked: boolean) => {
    setPublicLists((prev) =>
      checked ? [...prev, name] : prev.filter((n) => n !== name),
    );
  }, []);

  const handleSave = useCallback(async () => {
    try {
      await savePublishConfig({
        endpoint,
        region,
        bucket,
        accessKeyId,
        publicBaseUrl,
        privatePrefix,
        publicPrefix,
        imagesManifestUrl,
        webhookUrl,
        publicPriceLists: publicLists,
        ...(secretTouched ? { secretAccessKey } : {}),
      });
      setSecretTouched(false);
      setSecretAccessKey('');
      toast({ description: 'Publish settings saved', variant: 'success' });
    } catch (error) {
      toast({
        description: `Could not save publish settings: ${
          (error as Error)?.message ?? 'unknown error'
        }`,
        variant: 'destructive',
      });
    }
  }, [
    accessKeyId,
    bucket,
    endpoint,
    imagesManifestUrl,
    privatePrefix,
    publicBaseUrl,
    publicLists,
    publicPrefix,
    region,
    savePublishConfig,
    secretAccessKey,
    secretTouched,
    webhookUrl,
  ]);

  const handlePreview = useCallback(async () => {
    setPreviewing(true);
    try {
      setPreview(await previewCatalog());
    } catch (error) {
      toast({
        description: `Preview failed: ${
          (error as Error)?.message ?? 'unknown error'
        }`,
        variant: 'destructive',
      });
    } finally {
      setPreviewing(false);
    }
  }, [previewCatalog]);

  const handlePublish = useCallback(async () => {
    setPublishing(true);
    try {
      const result = await runPublish();
      toast({
        description: result.ok
          ? `Published ${result.publishableCount} item(s) to ${result.uploaded.length} file(s).`
          : `Publish failed: ${result.error}`,
        variant: result.ok ? 'success' : 'destructive',
      });
    } catch (error) {
      toast({
        description: `Publish failed: ${
          (error as Error)?.message ?? 'unknown error'
        }`,
        variant: 'destructive',
      });
    } finally {
      setPublishing(false);
    }
  }, [runPublish]);

  if (loading) return <p className="text-sm">Loading publish settings…</p>;

  return (
    <div className="flex flex-col gap-6">
      {!config.encryptionAvailable && (
        <p className="text-sm text-destructive">
          Secure storage is unavailable on this system, so the secret access key
          cannot be saved. Other settings will still be stored.
        </p>
      )}

      <div>
        <h3 className="text-lg font-medium">Connection</h3>
        <p className="text-xs text-muted-foreground">
          Where catalog files are uploaded. Any S3-compatible storage works.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field
          id="publish-endpoint"
          label="Storage endpoint"
          required
          placeholder="https://<account-id>.example-storage.com"
          value={endpoint}
          onChange={setEndpoint}
          hint="The S3 API URL used to upload. Not the public URL readers use."
        />
        <Field
          id="publish-bucket"
          label="Bucket"
          required
          value={bucket}
          onChange={setBucket}
        />
        <Field
          id="publish-access-key"
          label="Access key ID"
          required
          value={accessKeyId}
          onChange={setAccessKeyId}
        />
        <Field
          id="publish-secret"
          label="Secret access key"
          required
          type="password"
          placeholder={config.hasSecretAccessKey ? '••••••••' : ''}
          value={secretAccessKey}
          onChange={(value) => {
            setSecretAccessKey(value);
            setSecretTouched(true);
          }}
          hint={
            config.hasSecretAccessKey
              ? 'A key is saved in the system keychain. Type a new one to replace it.'
              : 'Stored in the system keychain, never in the app files.'
          }
        />
      </div>

      <div>
        <h3 className="text-lg font-medium">
          Public price lists
          <Required />
        </h3>
        <p className="text-xs text-muted-foreground">
          Only the price lists selected here are written to the public catalog.
          The base item price is never published.
        </p>
      </div>
      {priceListNames.length === 0 ? (
        <span className="text-sm text-muted-foreground">
          No price lists defined yet.
        </span>
      ) : (
        <div className="flex flex-wrap gap-4">
          {priceListNames.map((name) => (
            <div key={name} className="flex items-center gap-2">
              <Checkbox
                id={`publish-list-${name}`}
                checked={publicLists.includes(name)}
                onCheckedChange={(checked) =>
                  togglePublicList(name, checked === true)
                }
              />
              <Label htmlFor={`publish-list-${name}`}>{name}</Label>
            </div>
          ))}
        </div>
      )}

      <div>
        <Button
          type="button"
          variant="ghost"
          className="px-0 gap-2"
          onClick={() => setShowAdvanced((prev) => !prev)}
          aria-expanded={showAdvanced}
        >
          {showAdvanced ? (
            <ChevronDown size={16} />
          ) : (
            <ChevronRight size={16} />
          )}
          Advanced (optional)
        </Button>
        {showAdvanced && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
            <Field
              id="publish-public-base"
              label="Public base URL"
              placeholder="https://cdn.example.com"
              value={publicBaseUrl}
              onChange={setPublicBaseUrl}
              hint="Where readers fetch published files. Recorded for downstream systems; it does not affect uploading."
            />
            <Field
              id="publish-images-manifest"
              label="Images manifest URL"
              placeholder="https://cdn.example.com/images/images.json"
              value={imagesManifestUrl}
              onChange={setImagesManifestUrl}
              hint="Used to tell which items have an image. Without it, no item counts as having one."
            />
            <Field
              id="publish-private-prefix"
              label="Private path prefix"
              value={privatePrefix}
              onChange={setPrivatePrefix}
              hint="Folder for the full catalog (all price lists). Keep this path private in your bucket."
            />
            <Field
              id="publish-public-prefix"
              label="Public path prefix"
              value={publicPrefix}
              onChange={setPublicPrefix}
              hint="Folder for the public catalog and CSV. This path may be exposed publicly."
            />
            <Field
              id="publish-region"
              label="Region"
              placeholder="auto"
              value={region}
              onChange={setRegion}
              hint="Most S3-compatible providers ignore this. Leave as auto unless yours requires a region."
            />
            <Field
              id="publish-webhook"
              label="Webhook URL"
              value={webhookUrl}
              onChange={setWebhookUrl}
              hint="Called after a successful publish, to trigger downstream automation."
            />
          </div>
        )}
      </div>

      {missing.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Not ready to publish yet — still needed: {missing.join(', ')}.
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave}>Save publish settings</Button>
        <Button variant="outline" onClick={handlePreview} disabled={previewing}>
          {previewing ? 'Checking…' : 'Preview catalog'}
        </Button>
        <Button
          variant="secondary"
          onClick={handlePublish}
          disabled={publishing || missing.length > 0}
          title={
            missing.length > 0
              ? `Still needed: ${missing.join(', ')}`
              : undefined
          }
        >
          {publishing ? 'Publishing…' : 'Publish now'}
        </Button>
      </div>

      {publishing && progress && (
        <p className="text-sm text-muted-foreground">{progress.message}</p>
      )}

      {!publishing && lastResult && (
        <div className="text-sm">
          {lastResult.ok ? (
            <p>
              Last publish: {lastResult.publishableCount} item(s) ready,{' '}
              {lastResult.uploaded.length} file(s) uploaded on{' '}
              {new Date(lastResult.generatedAt).toLocaleString()}.
            </p>
          ) : (
            <p className="text-destructive">
              Last publish failed: {lastResult.error}
            </p>
          )}
          {lastResult.webhook?.called && !lastResult.webhook.ok && (
            <p className="text-muted-foreground">
              Files uploaded, but the webhook did not succeed
              {lastResult.webhook.status
                ? ` (HTTP ${lastResult.webhook.status})`
                : ''}
              .
            </p>
          )}
        </div>
      )}

      {preview && (
        <div className="text-sm">
          <p>
            {preview.publishableCount} of {preview.candidateCount} items are
            ready to publish ({preview.publicCount} would appear in the public
            catalog).
          </p>
          <p className="text-muted-foreground">
            Missing image: {preview.missingImage} · missing attributes:{' '}
            {preview.missingAttributes} · missing a public price:{' '}
            {preview.missingPublicPrice}
          </p>
        </div>
      )}
    </div>
  );
};

export default PublishSettings;
