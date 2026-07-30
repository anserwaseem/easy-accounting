import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Input } from 'renderer/shad/ui/input';
import { Label } from 'renderer/shad/ui/label';
import { Button } from 'renderer/shad/ui/button';
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
  const [privateBucket, setPrivateBucket] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [secretTouched, setSecretTouched] = useState(false);
  const [publicBaseUrl, setPublicBaseUrl] = useState('');
  const [privatePrefix, setPrivatePrefix] = useState('');
  const [publicPrefix, setPublicPrefix] = useState('');
  const [imagesManifestUrl, setImagesManifestUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookToken, setWebhookToken] = useState('');
  const [webhookTokenTouched, setWebhookTokenTouched] = useState(false);
  const [publicList, setPublicList] = useState('');
  const [reservedNameChars, setReservedNameChars] = useState('');
  const [publishWithoutImages, setPublishWithoutImages] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [preview, setPreview] = useState<CatalogPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // hydrate local drafts once the stored config arrives
  useEffect(() => {
    if (loading) return;
    setEndpoint(config.endpoint);
    setRegion(config.region);
    setBucket(config.bucket);
    setPrivateBucket(config.privateBucket);
    setAccessKeyId(config.accessKeyId);
    setPublicBaseUrl(config.publicBaseUrl);
    setPrivatePrefix(config.privatePrefix);
    setPublicPrefix(config.publicPrefix);
    setImagesManifestUrl(config.imagesManifestUrl);
    setWebhookUrl(config.webhookUrl);
    setWebhookToken('');
    setWebhookTokenTouched(false);
    setPublicList(config.publicPriceList);
    setReservedNameChars(config.reservedNameChars);
    setPublishWithoutImages(config.publishWithoutImages);
  }, [loading, config]);

  // readiness reflects what is typed now, treating a typed secret as present
  const missing = useMemo(
    () =>
      missingPublishConfig({
        endpoint,
        bucket,
        accessKeyId,
        hasSecretAccessKey: config.hasSecretAccessKey || !!secretAccessKey,
        publicPriceList: publicList,
      }),
    [
      endpoint,
      bucket,
      accessKeyId,
      config.hasSecretAccessKey,
      secretAccessKey,
      publicList,
    ],
  );

  // preview and publish act on the SAVED config, so block them while the form
  // holds unsaved edits rather than silently reporting stale results
  const isDirty = useMemo(
    () =>
      secretTouched ||
      webhookTokenTouched ||
      endpoint !== config.endpoint ||
      region !== config.region ||
      bucket !== config.bucket ||
      privateBucket !== config.privateBucket ||
      accessKeyId !== config.accessKeyId ||
      publicBaseUrl !== config.publicBaseUrl ||
      privatePrefix !== config.privatePrefix ||
      publicPrefix !== config.publicPrefix ||
      imagesManifestUrl !== config.imagesManifestUrl ||
      webhookUrl !== config.webhookUrl ||
      publicList !== config.publicPriceList ||
      reservedNameChars !== config.reservedNameChars ||
      publishWithoutImages !== config.publishWithoutImages,
    [
      config,
      secretTouched,
      webhookTokenTouched,
      endpoint,
      region,
      bucket,
      privateBucket,
      accessKeyId,
      publicBaseUrl,
      privatePrefix,
      publicPrefix,
      imagesManifestUrl,
      webhookUrl,
      publicList,
      reservedNameChars,
      publishWithoutImages,
    ],
  );

  const handleSave = useCallback(async () => {
    try {
      await savePublishConfig({
        endpoint,
        region,
        bucket,
        privateBucket,
        accessKeyId,
        publicBaseUrl,
        privatePrefix,
        publicPrefix,
        imagesManifestUrl,
        webhookUrl,
        publicPriceList: publicList,
        reservedNameChars,
        publishWithoutImages,
        ...(secretTouched ? { secretAccessKey } : {}),
        ...(webhookTokenTouched ? { webhookToken: webhookToken.trim() } : {}),
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
    privateBucket,
    endpoint,
    reservedNameChars,
    imagesManifestUrl,
    privatePrefix,
    publicBaseUrl,
    publicList,
    publicPrefix,
    publishWithoutImages,
    region,
    savePublishConfig,
    secretAccessKey,
    secretTouched,
    webhookToken,
    webhookTokenTouched,
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
      let description: string;
      if (!result.ok) {
        description = `Publish failed: ${result.error}`;
      } else if (result.skipped) {
        description =
          'No catalog changes since the last publish — nothing uploaded.';
      } else {
        description = `Published ${result.publishableCount} item(s) to ${result.uploaded.length} file(s).`;
      }
      toast({
        description,
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
          id="publish-private-bucket"
          label="Private bucket"
          value={privateBucket}
          onChange={setPrivateBucket}
          hint="Strongly recommended when the bucket above is publicly readable: public access is usually bucket-wide, so a separate never-published bucket is what keeps the full catalog private. Leave empty to use the same bucket."
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
          Public price list
          <Required />
        </h3>
        <p className="text-xs text-muted-foreground">
          The one price list published as each item&apos;s public price. The
          base item price and every other list stay private.
        </p>
      </div>
      {priceListNames.length === 0 ? (
        <span className="text-sm text-muted-foreground">
          No active price lists yet — create one from Inventory → Price lists.
        </span>
      ) : (
        <div className="flex flex-wrap gap-4">
          {priceListNames.map((name) => (
            <div key={name} className="flex items-center gap-2">
              <input
                type="radio"
                id={`publish-list-${name}`}
                name="publish-public-price-list"
                checked={publicList === name}
                onChange={() => setPublicList(name)}
              />
              <Label htmlFor={`publish-list-${name}`}>{name}</Label>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            className="h-auto py-0 px-2 text-xs"
            onClick={() => setPublicList('')}
            disabled={!publicList}
          >
            Clear (publish nothing)
          </Button>
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
              id="publish-reserved-chars"
              label="Characters not allowed in item names"
              placeholder="e.g. ~_"
              value={reservedNameChars}
              onChange={setReservedNameChars}
              hint="Type the characters your publishing pipeline reserves, with no separators. Item names containing them are rejected on save. Leave empty for no restriction."
            />
            <label
              htmlFor="publish-without-images"
              className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950"
            >
              <input
                id="publish-without-images"
                type="checkbox"
                className="mt-1"
                checked={publishWithoutImages}
                onChange={(e) => setPublishWithoutImages(e.target.checked)}
              />
              <span className="text-sm">
                <span className="font-medium">
                  Publish items that have no photograph yet
                </span>
                <span className="mt-1 block text-muted-foreground">
                  For setting up and testing the storefront before photography
                  is done — the shop shows a placeholder image. Turn this off
                  before going live: the next publish then withdraws every item
                  still lacking a photograph.
                </span>
              </span>
            </label>
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
              hint="Called after a successful publish, to trigger downstream automation. The body is {event_type: 'publish', client_payload: {…}}."
            />
            <Field
              id="publish-webhook-token"
              label="Webhook token"
              type="password"
              placeholder={config.hasWebhookToken ? '••••••••' : ''}
              value={webhookToken}
              onChange={(value) => {
                setWebhookToken(value);
                setWebhookTokenTouched(true);
              }}
              hint={
                config.hasWebhookToken
                  ? 'A token is saved in the system keychain. Type a new one to replace it, or a single space to clear it.'
                  : 'Sent as an Authorization: Bearer header. Stored in the system keychain, never in the app files.'
              }
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
        <Button
          variant="outline"
          onClick={handlePreview}
          disabled={previewing || isDirty}
          title={isDirty ? 'Save your changes first' : undefined}
        >
          {previewing ? 'Checking…' : 'Preview catalog'}
        </Button>
        <Button
          variant="secondary"
          onClick={handlePublish}
          disabled={publishing || isDirty || missing.length > 0}
          title={
            (isDirty && 'Save your changes first') ||
            (missing.length > 0 && `Still needed: ${missing.join(', ')}`) ||
            undefined
          }
        >
          {publishing ? 'Publishing…' : 'Publish now'}
        </Button>
      </div>

      {isDirty && (
        <p className="text-sm text-muted-foreground">
          You have unsaved changes. Save them before previewing or publishing —
          both act on the saved settings.
        </p>
      )}

      {publishing && progress && (
        <p className="text-sm text-muted-foreground">{progress.message}</p>
      )}

      {!publishing && lastResult && (
        <div className="text-sm">
          {lastResult.ok ? (
            <p>
              Last publish: {lastResult.publishableCount} item(s) ready,{' '}
              {lastResult.uploaded.length} file(s) uploaded on{' '}
              {new Date(lastResult.generatedAt).toLocaleString(undefined, {
                dateStyle: 'long',
                timeStyle: 'medium',
                hour12: true,
              })}
              .
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
          {lastResult.privateExposureWarning && (
            <p className="text-destructive font-medium">
              {lastResult.privateExposureWarning}
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
            {preview.heldBack > 0 ? (
              <> · held back on purpose: {preview.heldBack}</>
            ) : null}
          </p>
          {preview.imagesManifestError && (
            <p className="text-destructive">
              {preview.imagesManifestError} Until this is fixed, no item can be
              published.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default PublishSettings;
