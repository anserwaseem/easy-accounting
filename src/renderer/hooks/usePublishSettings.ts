import { useCallback, useEffect, useMemo, useState } from 'react';

/** Mirrors main/utils/publishConfig — secrets are never included. */
export interface PublishConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  publicBaseUrl: string;
  privatePrefix: string;
  publicPrefix: string;
  publicPriceLists: string[];
  imagesManifestUrl: string;
  webhookUrl: string;
  hasSecretAccessKey: boolean;
  hasWebhookToken: boolean;
  encryptionAvailable: boolean;
}

export interface PublishConfigInput
  extends Partial<
    Omit<
      PublishConfig,
      'hasSecretAccessKey' | 'hasWebhookToken' | 'encryptionAvailable'
    >
  > {
  secretAccessKey?: string;
  webhookToken?: string;
}

export interface CatalogPreview {
  candidateCount: number;
  publicCount: number;
  publishableCount: number;
  missingImage: number;
  missingAttributes: number;
  missingPublicPrice: number;
}

/**
 * Which required pieces are still missing (empty array = ready to publish).
 * Mirrors validatePublishConfig in main/utils/publishConfig so the form can
 * show readiness against what is currently typed, before saving.
 */
export const missingPublishConfig = (config: {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  hasSecretAccessKey: boolean;
  publicPriceLists: string[];
}): string[] => {
  const missing: string[] = [];
  if (!config.endpoint.trim()) missing.push('storage endpoint');
  if (!config.bucket.trim()) missing.push('bucket');
  if (!config.accessKeyId.trim()) missing.push('access key ID');
  if (!config.hasSecretAccessKey) missing.push('secret access key');
  if (config.publicPriceLists.length === 0)
    missing.push('at least one public price list');
  return missing;
};

const EMPTY_CONFIG: PublishConfig = {
  endpoint: '',
  region: 'auto',
  bucket: '',
  accessKeyId: '',
  publicBaseUrl: '',
  privatePrefix: 'catalog/private',
  publicPrefix: 'catalog/public',
  publicPriceLists: [],
  imagesManifestUrl: '',
  webhookUrl: '',
  hasSecretAccessKey: false,
  hasWebhookToken: false,
  encryptionAvailable: false,
};

export const usePublishSettings = () => {
  const [config, setConfig] = useState<PublishConfig>(EMPTY_CONFIG);
  const [priceListNames, setPriceListNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [nextConfig, names] = await Promise.all([
      window.electron.getPublishConfig(),
      window.electron.getPriceListNames(),
    ]);
    setConfig(nextConfig);
    setPriceListNames(names);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const savePublishConfig = useCallback(async (input: PublishConfigInput) => {
    const next = await window.electron.savePublishConfig(input);
    setConfig(next);
    return next;
  }, []);

  const previewCatalog = useCallback(
    () => window.electron.previewCatalog(),
    [],
  );

  return useMemo(
    () => ({
      config,
      priceListNames,
      loading,
      savePublishConfig,
      previewCatalog,
      refresh,
    }),
    [
      config,
      priceListNames,
      loading,
      savePublishConfig,
      previewCatalog,
      refresh,
    ],
  );
};
