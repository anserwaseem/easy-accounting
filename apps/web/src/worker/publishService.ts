/**
 * Web-build twin of `src/main/services/Publish.service.ts`.
 *
 * Price-list CRUD, catalog shaping, preview, and the publish run itself —
 * everything the desktop service does except writing catalog files to disk
 * (kept in memory here) and talking to S3 through the AWS SDK (see
 * ./s3Put.ts). Catalog math stays in the shared pure modules under
 * `src/main/utils/` (`catalog`, `catalogQuery`, `priceSeeding`,
 * `publishTargets`, `imageManifestCache`); this file is the sqlite-wasm
 * + fetch adapter around them.
 *
 * Progress events are posted to the main thread as `{ type:
 * 'publish-progress' }` (see ../api/rpc.ts), which electronShim turns into
 * the same `ipcRenderer.on('publish-progress')` the Settings screen already
 * listens for on desktop.
 */
import type { DatabaseDriver } from '@core/db/driver';
import type { KeyValueStore } from '@core/ports';
import type {
  CatalogPreview,
  PriceListSummary,
  PublishConfig,
  PublishResult,
  SeedOptions,
  SeedPlan,
} from '@core/api/AppApi';
import {
  buildFullCatalog,
  buildPublicCatalog,
  isPublishable,
  parseAttributeKeyList,
  publishBlockers,
  toProductsCsv,
  type CatalogSourceRow,
  type PublishBlocker as CatalogBlocker,
} from '@/main/utils/catalog';
import {
  CATALOG_QUERY,
  mapCatalogRow,
  type RawCatalogRow,
} from '@/main/utils/catalogQuery';
import {
  canUseCachedManifest,
  isCacheableManifestResult,
} from '@/main/utils/imageManifestCache';
import { buildSeedPlan, type SeedInputRow } from '@/main/utils/priceSeeding';
import {
  buildPublishTargets,
  unsafeTargetReason,
} from '@/main/utils/publishTargets';
import { putS3Object } from './s3Put';

export type PublishBlocker = CatalogBlocker | 'image check failed';

export interface ItemPublishStatus {
  id: number;
  state: 'ready' | 'held back' | 'not ready';
  blockers: PublishBlocker[];
}

export interface ItemPublishStatusReport {
  statuses: ItemPublishStatus[];
  imagesManifestError?: string;
}

export interface PublishProgressEvent {
  status: 'generating' | 'uploading' | 'notifying' | 'success' | 'error';
  message: string;
}

const LAST_RESULT_KEY = 'publish.lastResult';

const SQL = {
  getPriceListNames: `SELECT name FROM price_lists WHERE isActive = 1 ORDER BY name`,
  getPriceLists: `SELECT pl.id, pl.name, pl.isActive,
            (SELECT COUNT(*) FROM inventory_prices ip
              WHERE ip.priceListId = pl.id) AS itemCount
       FROM price_lists pl ORDER BY pl.name`,
  insertPriceList: `INSERT OR IGNORE INTO price_lists (name) VALUES (?)`,
  renamePriceList: `UPDATE price_lists SET name = ? WHERE id = ?`,
  togglePriceList: `UPDATE price_lists SET isActive = ? WHERE id = ?`,
  getPublicAttributeKeys: `SELECT key FROM attribute_definitions
        WHERE isPublic = 1 AND isActive = 1
        ORDER BY sortOrder ASC, label ASC`,
  getSeedRows: `SELECT i.id AS inventoryId, i.name AS name, i.price AS basePrice,
            ip.price AS currentPrice
       FROM inventory i
       LEFT JOIN inventory_prices ip
              ON ip.inventoryId = i.id AND ip.priceListId = ?
      ORDER BY i.name`,
  upsertInventoryPrice: `INSERT INTO inventory_prices (inventoryId, priceListId, price)
     VALUES (?, ?, ?)
     ON CONFLICT(inventoryId, priceListId)
     DO UPDATE SET price = excluded.price`,
};

function validatePublishConfig(config: PublishConfig): string[] {
  const missing: string[] = [];
  if (!config.endpoint) missing.push('endpoint');
  if (!config.bucket) missing.push('bucket');
  if (!config.accessKeyId) missing.push('access key ID');
  if (!config.hasSecretAccessKey) missing.push('secret access key');
  if (!config.publicPriceList) missing.push('a public price list');
  return missing;
}

function asJsonText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function describeManifestFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed to fetch|Load failed|NetworkError|CORS/i.test(message)) {
    return `Could not read the images manifest (often CORS). Allow GET from this origin on the manifest host. ${message}`;
  }
  return `Could not read the images manifest: ${message}`;
}

async function contentFingerprint(payloads: {
  full: string;
  public: string;
  csv: string;
}): Promise<string> {
  // Same concatenated UTF-8 bytes as Node `createHash('sha256').update(a).update(b).update(c)`.
  const strip = (json: string): string =>
    json.replace(/"generatedAt"\s*:\s*("[^"]*"|null)/g, '"generatedAt":null');
  const enc = new TextEncoder();
  const a = enc.encode(strip(payloads.full));
  const b = enc.encode(strip(payloads.public));
  const c = enc.encode(payloads.csv);
  const joined = new Uint8Array(a.length + b.length + c.length);
  joined.set(a, 0);
  joined.set(b, a.length);
  joined.set(c, a.length + b.length);
  const hash = await crypto.subtle.digest('SHA-256', joined);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export class WebPublishService {
  private static imageSkusCache: {
    url: string;
    result: { skus: Set<string>; error?: string };
  } | null = null;

  constructor(
    private readonly db: DatabaseDriver,
    private readonly kv: KeyValueStore,
    private readonly getConfig: () => Promise<PublishConfig>,
    private readonly getSecrets: () => {
      secretAccessKey: string;
      webhookToken: string;
    },
    private readonly onProgress: (event: PublishProgressEvent) => void,
  ) {}

  public async getPriceListNames(): Promise<string[]> {
    const rows = await this.db.all<{ name: string }>(SQL.getPriceListNames);
    return rows.map((r) => r.name);
  }

  public async getPriceLists(): Promise<PriceListSummary[]> {
    return this.db.all<PriceListSummary>(SQL.getPriceLists);
  }

  public async createPriceList(name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const info = await this.db.run(SQL.insertPriceList, [trimmed]);
    return info.changes > 0;
  }

  public async renamePriceList(id: number, name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const info = await this.db.run(SQL.renamePriceList, [trimmed, id]);
    return info.changes > 0;
  }

  public async setPriceListActive(
    id: number,
    isActive: boolean,
  ): Promise<boolean> {
    const info = await this.db.run(SQL.togglePriceList, [isActive ? 1 : 0, id]);
    return info.changes > 0;
  }

  public async getSeedRows(
    priceListId: number,
    inventoryIds?: number[],
  ): Promise<SeedInputRow[]> {
    const rows = await this.db.all<{
      inventoryId: number;
      name: string;
      basePrice: number;
      currentPrice: number | null;
    }>(SQL.getSeedRows, [priceListId]);
    if (!inventoryIds || inventoryIds.length === 0) return rows;
    const wanted = new Set(inventoryIds);
    return rows.filter((r) => wanted.has(r.inventoryId));
  }

  public async previewSeed(
    priceListId: number,
    options: SeedOptions,
    inventoryIds?: number[],
  ): Promise<SeedPlan> {
    return buildSeedPlan(
      await this.getSeedRows(priceListId, inventoryIds),
      options,
    );
  }

  public async applySeed(
    priceListId: number,
    options: SeedOptions,
    inventoryIds?: number[],
  ): Promise<{ applied: number; plan: SeedPlan }> {
    const plan = await this.previewSeed(priceListId, options, inventoryIds);
    const applied = await this.db.transaction(async () => {
      for (const change of plan.changes) {
        // sequential upserts inside one transaction, same as desktop
        // eslint-disable-next-line no-await-in-loop
        await this.db.run(SQL.upsertInventoryPrice, [
          change.inventoryId,
          priceListId,
          change.to,
        ]);
      }
      return plan.changes.length;
    });
    return { applied, plan };
  }

  public async getPublicAttributeKeys(): Promise<string[]> {
    const rows = await this.db.all<{ key: string }>(SQL.getPublicAttributeKeys);
    return rows.map((r) => r.key);
  }

  public async getCatalogRows(
    imageSkus: Set<string> = new Set(),
  ): Promise<CatalogSourceRow[]> {
    const raw = await this.db.all<RawCatalogRow>(CATALOG_QUERY);
    return raw.map((row) =>
      mapCatalogRow(
        { ...row, pricesJson: asJsonText(row.pricesJson) },
        imageSkus,
      ),
    );
  }

  public async getItemPublishStatuses(): Promise<ItemPublishStatusReport> {
    const options = await this.catalogOptions();
    const { skus: imageSkus, error: imagesManifestError } =
      await WebPublishService.fetchImageSkus(options.imagesManifestUrl);
    const raw = await this.db.all<RawCatalogRow>(CATALOG_QUERY);

    const statuses = raw.map((rawRow) => {
      const row = mapCatalogRow(
        { ...rawRow, pricesJson: asJsonText(rawRow.pricesJson) },
        imageSkus,
      );
      if (row.excludeFromCatalog) {
        return { id: rawRow.id, state: 'held back' as const, blockers: [] };
      }
      const blockers: PublishBlocker[] = publishBlockers(row, options).map(
        (blocker) =>
          blocker === 'no image' && imagesManifestError
            ? 'image check failed'
            : blocker,
      );
      return blockers.length === 0
        ? { id: rawRow.id, state: 'ready' as const, blockers: [] }
        : { id: rawRow.id, state: 'not ready' as const, blockers };
    });
    return { statuses, imagesManifestError };
  }

  public async previewCatalog(): Promise<CatalogPreview> {
    const options = await this.catalogOptions();
    const { skus: imageSkus, error: imagesManifestError } =
      await WebPublishService.fetchImageSkus(options.imagesManifestUrl, {
        force: true,
      });
    const rows = await this.getCatalogRows(imageSkus);
    let publicCount = 0;
    let publishableCount = 0;
    let missingImage = 0;
    let missingAttributes = 0;
    let missingPublicPrice = 0;
    let heldBack = 0;

    for (const row of rows) {
      if (row.excludeFromCatalog) heldBack += 1;
      const blockers = publishBlockers(row, options);
      if (blockers.includes('no public price')) missingPublicPrice += 1;
      else publicCount += 1;
      if (blockers.includes('no public attributes')) missingAttributes += 1;
      if (!row.hasImage) missingImage += 1;
      if (isPublishable(row, options)) publishableCount += 1;
    }

    return {
      candidateCount: rows.length,
      publicCount,
      publishableCount,
      heldBack,
      missingImage,
      missingAttributes,
      missingPublicPrice,
      ...(imagesManifestError ? { imagesManifestError } : {}),
    };
  }

  public getLastResult(): PublishResult | null {
    const value = this.kv.get(LAST_RESULT_KEY);
    return value ? (value as PublishResult) : null;
  }

  public async publish(force = false): Promise<PublishResult> {
    const generatedAt = new Date().toISOString();
    const config = await this.getConfig();

    const missing = validatePublishConfig(config);
    if (missing.length > 0) {
      return this.fail(
        `Publish is not configured yet — still needed: ${missing.join(', ')}.`,
        generatedAt,
      );
    }

    const unsafe = unsafeTargetReason(config);
    if (unsafe) {
      return this.fail(unsafe, generatedAt);
    }

    const { secretAccessKey, webhookToken } = this.getSecrets();
    if (!secretAccessKey) {
      return this.fail(
        'Publish is not configured yet — still needed: secret access key.',
        generatedAt,
      );
    }

    try {
      this.emitProgress('generating', 'Generating catalog files…');
      const { skus: imageSkus } = await WebPublishService.fetchImageSkus(
        config.imagesManifestUrl,
        { force: true },
      );
      const publicAttributeKeys = await this.getPublicAttributeKeys();
      const opts = {
        publicPriceList: config.publicPriceList,
        publicAttributeKeys,
        requireImage: !config.publishWithoutImages,
        requiredAttributeKeys: parseAttributeKeyList(
          config.requiredAttributeKeys,
        ),
      };
      const rows = await this.getCatalogRows(imageSkus);
      const full = buildFullCatalog(rows, opts, generatedAt);
      const pub = buildPublicCatalog(rows, opts, generatedAt);
      const csv = toProductsCsv(pub);
      const files = {
        full: JSON.stringify(full, null, 2),
        public: JSON.stringify(pub),
        csv,
      };

      const fingerprint = await contentFingerprint(files);
      const previous = this.getLastResult();
      if (!force && previous?.ok && previous.fingerprint === fingerprint) {
        const unchanged: PublishResult = {
          ...previous,
          generatedAt,
          skipped: true,
        };
        this.kv.set(LAST_RESULT_KEY, unchanged);
        this.emitProgress(
          'success',
          'No catalog changes since the last publish — nothing uploaded.',
        );
        return unchanged;
      }

      const targets = buildPublishTargets(config);
      const uploaded: string[] = [];
      const bodyByFileName: Record<string, string> = {
        'catalog-full.json': files.full,
        'catalog-public.json': files.public,
        'products.csv': files.csv,
      };
      for (const target of targets) {
        this.emitProgress('uploading', `Uploading ${target.key}…`);
        // sequential: the file set is tiny and ordering keeps logs readable
        // eslint-disable-next-line no-await-in-loop
        await putS3Object({
          endpoint: config.endpoint,
          region: config.region || 'auto',
          accessKeyId: config.accessKeyId,
          secretAccessKey,
          bucket: target.bucket,
          key: target.key,
          body: bodyByFileName[target.fileName],
          contentType: target.contentType,
        });
        uploaded.push(`${target.bucket}/${target.key}`);
      }

      const privateTarget = targets.find((t) => !t.isPublic);
      const sharesPublicBucket = privateTarget?.bucket === config.bucket;
      const privateExposureWarning = sharesPublicBucket
        ? await this.checkPrivateExposure(
            config.publicBaseUrl,
            privateTarget?.key,
          )
        : undefined;

      const webhook = await this.callWebhook(config.webhookUrl, webhookToken, {
        event_type: 'publish',
        client_payload: {
          generatedAt,
          publishableCount: pub.items.filter((i) => i.publishable).length,
          publicCount: pub.count,
        },
      });

      const result: PublishResult = {
        ok: true,
        generatedAt,
        fullCount: full.count,
        publicCount: pub.count,
        publishableCount: pub.items.filter((i) => i.publishable).length,
        uploaded,
        webhook,
        fingerprint,
        skipped: false,
        ...(privateExposureWarning ? { privateExposureWarning } : {}),
      };
      this.kv.set(LAST_RESULT_KEY, result);
      this.emitProgress(
        'success',
        `Published ${result.publishableCount} item(s).`,
      );
      return result;
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown error';
      // eslint-disable-next-line no-console
      console.error('Publish failed', error);
      return this.fail(message, generatedAt);
    }
  }

  private async catalogOptions(): Promise<{
    publicPriceList: string;
    publicAttributeKeys: string[];
    imagesManifestUrl: string;
    requireImage: boolean;
    requiredAttributeKeys: string[];
  }> {
    const config = await this.getConfig();
    return {
      publicPriceList: config.publicPriceList,
      publicAttributeKeys: await this.getPublicAttributeKeys(),
      imagesManifestUrl: config.imagesManifestUrl,
      requireImage: !config.publishWithoutImages,
      requiredAttributeKeys: parseAttributeKeyList(
        config.requiredAttributeKeys,
      ),
    };
  }

  private fail(error: string, generatedAt: string): PublishResult {
    this.emitProgress('error', error);
    const result: PublishResult = {
      ok: false,
      error,
      generatedAt,
      fullCount: 0,
      publicCount: 0,
      publishableCount: 0,
      uploaded: [],
    };
    this.kv.set(LAST_RESULT_KEY, result);
    return result;
  }

  private emitProgress(
    status: PublishProgressEvent['status'],
    message: string,
  ): void {
    this.onProgress({ status, message });
  }

  private async checkPrivateExposure(
    publicBaseUrl: string,
    privateKey?: string,
  ): Promise<string | undefined> {
    if (!publicBaseUrl || !privateKey) return undefined;
    const url = `${publicBaseUrl.replace(/\/+$/, '')}/${privateKey}`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
      });
      if (response.ok || response.status === 206) {
        // eslint-disable-next-line no-console
        console.error(
          `Publish: private catalog is publicly readable at ${url}`,
        );
        return `The full catalog is publicly readable at ${url}. It contains every price list. Restrict public access to the public path prefix only, or use a separate private bucket.`;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async callWebhook(
    url: string,
    token: string,
    payload: Record<string, unknown>,
  ): Promise<PublishResult['webhook']> {
    if (!url) return { called: false, ok: true };
    this.emitProgress('notifying', 'Notifying webhook…');
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        // eslint-disable-next-line no-console
        console.warn(`Publish webhook returned ${response.status}`);
      }
      return { called: true, ok: response.ok, status: response.status };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown error';
      // eslint-disable-next-line no-console
      console.warn('Publish webhook failed', error);
      return { called: true, ok: false, error: message };
    }
  }

  private static async fetchImageSkus(
    url?: string,
    { force = false }: { force?: boolean } = {},
  ): Promise<{ skus: Set<string>; error?: string }> {
    if (canUseCachedManifest(WebPublishService.imageSkusCache, url, force)) {
      return WebPublishService.imageSkusCache!.result;
    }
    if (!url) {
      return {
        skus: new Set(),
        error:
          'No images manifest URL is set, so no item counts as having one.',
      };
    }
    try {
      const response = await fetch(url);
      if (!response.ok) {
        const error = `Images manifest returned HTTP ${response.status}.`;
        // eslint-disable-next-line no-console
        console.warn(`Publish: ${error}`);
        return { skus: new Set(), error };
      }
      const manifest = (await response.json()) as {
        skus?: Record<string, unknown>;
      };
      const skus = new Set(Object.keys(manifest?.skus ?? {}));
      const result =
        skus.size === 0
          ? { skus, error: 'The images manifest lists no images.' }
          : { skus };
      if (isCacheableManifestResult(result)) {
        WebPublishService.imageSkusCache = { url, result };
      }
      return result;
    } catch (error) {
      const message = describeManifestFailure(error);
      // eslint-disable-next-line no-console
      console.warn(`Publish: ${message}`);
      return { skus: new Set(), error: message };
    }
  }
}
