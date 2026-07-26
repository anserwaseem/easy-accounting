import { useCallback, useEffect, useMemo, useState } from 'react';

/** Mirrors main/utils/publishConfig — secrets are never included. */
export interface PublishConfig {
  endpoint: string;
  region: string;
  bucket: string;
  privateBucket: string;
  accessKeyId: string;
  publicBaseUrl: string;
  privatePrefix: string;
  publicPrefix: string;
  publicPriceList: string;
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

export interface PriceListSummary {
  id: number;
  name: string;
  isActive: number;
  itemCount: number;
}

export interface CatalogPreview {
  candidateCount: number;
  publicCount: number;
  publishableCount: number;
  missingImage: number;
  missingAttributes: number;
  missingPublicPrice: number;
}

export interface PublishResult {
  ok: boolean;
  error?: string;
  generatedAt: string;
  fullCount: number;
  publicCount: number;
  publishableCount: number;
  uploaded: string[];
  webhook?: { called: boolean; ok: boolean; status?: number; error?: string };
  privateExposureWarning?: string;
  fingerprint?: string;
  skipped?: boolean;
}

export interface PublishProgressEvent {
  status: 'generating' | 'uploading' | 'notifying' | 'success' | 'error';
  message: string;
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
  publicPriceList: string;
}): string[] => {
  const missing: string[] = [];
  if (!config.endpoint.trim()) missing.push('storage endpoint');
  if (!config.bucket.trim()) missing.push('bucket');
  if (!config.accessKeyId.trim()) missing.push('access key ID');
  if (!config.hasSecretAccessKey) missing.push('secret access key');
  if (!config.publicPriceList) missing.push('a public price list');
  return missing;
};

const EMPTY_CONFIG: PublishConfig = {
  endpoint: '',
  region: 'auto',
  bucket: '',
  privateBucket: '',
  accessKeyId: '',
  publicBaseUrl: '',
  privatePrefix: 'catalog/private',
  publicPrefix: 'catalog/public',
  publicPriceList: '',
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
  const [priceLists, setPriceLists] = useState<PriceListSummary[]>([]);
  const [lastResult, setLastResult] = useState<PublishResult | null>(null);
  const [progress, setProgress] = useState<PublishProgressEvent | null>(null);

  const refresh = useCallback(async () => {
    const [nextConfig, names, lists, previous] = await Promise.all([
      window.electron.getPublishConfig(),
      window.electron.getPriceListNames(),
      window.electron.getPriceLists(),
      window.electron.getLastPublishResult(),
    ]);
    setConfig(nextConfig);
    setPriceListNames(names);
    setPriceLists(lists);
    setLastResult(previous);
    setLoading(false);
  }, []);

  // stream progress emitted by the main process during a publish run
  useEffect(
    () =>
      window.electron.ipcRenderer.on('publish-progress', (...args) =>
        setProgress(args[0] as PublishProgressEvent),
      ),
    [],
  );

  const runPublish = useCallback(async (force = false) => {
    setProgress(null);
    const result = await window.electron.runPublish(force);
    setLastResult(result);
    return result;
  }, []);

  const createPriceList = useCallback(
    async (name: string) => {
      const ok = await window.electron.createPriceList(name);
      await refresh();
      return ok;
    },
    [refresh],
  );

  const renamePriceList = useCallback(
    async (id: number, name: string) => {
      const ok = await window.electron.renamePriceList(id, name);
      await refresh();
      return ok;
    },
    [refresh],
  );

  const setPriceListActive = useCallback(
    async (id: number, isActive: boolean) => {
      const ok = await window.electron.setPriceListActive(id, isActive);
      await refresh();
      return ok;
    },
    [refresh],
  );

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
      priceLists,
      loading,
      lastResult,
      progress,
      runPublish,
      createPriceList,
      renamePriceList,
      setPriceListActive,
      savePublishConfig,
      previewCatalog,
      refresh,
    }),
    [
      config,
      priceListNames,
      priceLists,
      loading,
      lastResult,
      progress,
      runPublish,
      createPriceList,
      renamePriceList,
      setPriceListActive,
      savePublishConfig,
      previewCatalog,
      refresh,
    ],
  );
};
