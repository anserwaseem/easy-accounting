import fs from 'fs';
import path from 'path';
import type { Database, Statement } from 'better-sqlite3';
import log from 'electron-log';
import { app, BrowserWindow } from 'electron';
import { logErrors } from '../errorLogger';
import { store } from '../store';
import {
  getPublishConfig,
  getPublishSecrets,
  validatePublishConfig,
  PUBLISH_KEYS,
} from '../utils/publishConfig';
import {
  buildPublishTargets,
  contentFingerprint,
  unsafeTargetReason,
} from '../utils/publishTargets';
import {
  buildSeedPlan,
  type SeedInputRow,
  type SeedOptions,
  type SeedPlan,
} from '../utils/priceSeeding';
import { DatabaseService } from './Database.service';
import {
  CATALOG_QUERY,
  mapCatalogRow,
  type RawCatalogRow,
} from '../utils/catalogQuery';
import {
  buildFullCatalog,
  buildPublicCatalog,
  isPublishable,
  publicAttributesOf,
  publicPriceOf,
  toProductsCsv,
  type CatalogSourceRow,
} from '../utils/catalog';

interface GenerateCatalogOptions {
  /** The price list published as the public price (e.g. 'Retail'). */
  publicPriceList: string;
  /** Attribute keys marked public; anything else stays out of the public file. */
  publicAttributeKeys?: readonly string[];
  /** SKUs known to have an image (from the images manifest). */
  imageSkus?: Set<string>;
  /** Overridable for deterministic output; defaults to now (ISO). */
  generatedAt?: string;
}

interface GenerateCatalogResult {
  fullCount: number;
  publicCount: number;
  publishableCount: number;
  files: { full: string; public: string; csv: string };
}

export interface PriceListSummary {
  id: number;
  name: string;
  isActive: number;
  /** How many items carry a price on this list — deleting would drop these. */
  itemCount: number;
}

export interface CatalogPreview {
  /** Items that are catalog candidates (have attributes or a list price). */
  candidateCount: number;
  /** Items that would appear in the public catalog. */
  publicCount: number;
  /** Items meeting all publish criteria (attributes + public price + image). */
  publishableCount: number;
  /** Candidates missing an image, attributes, or a public price. */
  missingImage: number;
  missingAttributes: number;
  missingPublicPrice: number;
  /**
   * Set when the images manifest could not be read. Without this, "missing
   * image" counts look identical whether the manifest is unreachable or the
   * items genuinely have no imagery.
   */
  imagesManifestError?: string;
}

export interface PublishResult {
  ok: boolean;
  /** Present when the run failed. */
  error?: string;
  generatedAt: string;
  fullCount: number;
  publicCount: number;
  publishableCount: number;
  /** Object keys written, in upload order. */
  uploaded: string[];
  /** Whether the post-publish webhook was called, and how it went. */
  webhook?: { called: boolean; ok: boolean; status?: number; error?: string };
  /**
   * Set when the private catalog turned out to be readable over the public
   * base URL — i.e. the storage bucket exposes more than the public prefix.
   */
  privateExposureWarning?: string;
  /** Fingerprint of the uploaded content, ignoring the timestamp. */
  fingerprint?: string;
  /** True when the run found no changes and uploaded nothing. */
  skipped?: boolean;
}

export type PublishProgressStatus =
  | 'generating'
  | 'uploading'
  | 'notifying'
  | 'success'
  | 'error';

export interface PublishProgressEvent {
  status: PublishProgressStatus;
  message: string;
}

/**
 * Produces the catalog export files from the accounting DB. Generic: it emits
 * inventory + attributes (by their generic keys) + named price lists, and
 * enforces tier separation structurally via the pure builders in ../utils/catalog.
 *
 * A publish run writes the three files locally, uploads them to the configured
 * S3-compatible endpoint (full catalog under the private prefix, public catalog
 * and CSV under the public prefix), then optionally notifies a webhook.
 */
@logErrors
export class PublishService {
  private db: Database;

  private stmGetCatalogRows!: Statement;

  private stmGetPublicAttributeKeys!: Statement;

  private stmGetPriceListNames!: Statement;

  private stmGetPriceLists!: Statement;

  private stmInsertPriceList!: Statement;

  private stmRenamePriceList!: Statement;

  private stmTogglePriceList!: Statement;

  private stmGetSeedRows!: Statement;

  private stmUpsertInventoryPrice!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.stmGetCatalogRows = this.db.prepare(CATALOG_QUERY);
    this.stmGetPublicAttributeKeys = this.db.prepare(
      `SELECT key FROM attribute_definitions
        WHERE isPublic = 1 AND isActive = 1
        ORDER BY sortOrder ASC, label ASC`,
    );
    this.stmGetPriceListNames = this.db.prepare(
      `SELECT name FROM price_lists WHERE isActive = 1 ORDER BY name`,
    );
    this.stmGetPriceLists = this.db.prepare(
      `SELECT pl.id, pl.name, pl.isActive,
              (SELECT COUNT(*) FROM inventory_prices ip
                WHERE ip.priceListId = pl.id) AS itemCount
         FROM price_lists pl ORDER BY pl.name`,
    );
    this.stmInsertPriceList = this.db.prepare(
      `INSERT OR IGNORE INTO price_lists (name) VALUES (?)`,
    );
    this.stmRenamePriceList = this.db.prepare(
      `UPDATE price_lists SET name = ? WHERE id = ?`,
    );
    this.stmTogglePriceList = this.db.prepare(
      `UPDATE price_lists SET isActive = ? WHERE id = ?`,
    );
    this.stmGetSeedRows = this.db.prepare(
      `SELECT i.id AS inventoryId, i.name AS name, i.price AS basePrice,
              ip.price AS currentPrice
         FROM inventory i
         LEFT JOIN inventory_prices ip
                ON ip.inventoryId = i.id AND ip.priceListId = ?
        ORDER BY i.name`,
    );
    this.stmUpsertInventoryPrice = this.db.prepare(
      `INSERT INTO inventory_prices (inventoryId, priceListId, price)
       VALUES (?, ?, ?)
       ON CONFLICT(inventoryId, priceListId)
       DO UPDATE SET price = excluded.price`,
    );
  }

  /** Names of the active price lists — drives the "public price list" picker. */
  public getPriceListNames(): string[] {
    return (this.stmGetPriceListNames.all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
  }

  /** All price lists with their item counts, for the management screen. */
  public getPriceLists(): PriceListSummary[] {
    return this.stmGetPriceLists.all() as PriceListSummary[];
  }

  /** Creates a price list. Returns false when the name already exists. */
  public createPriceList(name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    const info = this.stmInsertPriceList.run(trimmed);
    return info.changes > 0;
  }

  public renamePriceList(id: number, name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    return this.stmRenamePriceList.run(trimmed, id).changes > 0;
  }

  public setPriceListActive(id: number, isActive: boolean): boolean {
    return this.stmTogglePriceList.run(isActive ? 1 : 0, id).changes > 0;
  }

  /**
   * Rows a seed/revision would consider: the base price plus the item's current
   * price on the target list. Optionally narrowed to specific inventory ids so
   * the caller can scope a revision to whatever the user has filtered to.
   */
  public getSeedRows(
    priceListId: number,
    inventoryIds?: number[],
  ): SeedInputRow[] {
    const rows = this.stmGetSeedRows.all(priceListId) as Array<{
      inventoryId: number;
      name: string;
      basePrice: number;
      currentPrice: number | null;
    }>;
    if (!inventoryIds || inventoryIds.length === 0) return rows;
    const wanted = new Set(inventoryIds);
    return rows.filter((r) => wanted.has(r.inventoryId));
  }

  /** Preview only — computes what a seed/revision would change. */
  public previewSeed(
    priceListId: number,
    options: SeedOptions,
    inventoryIds?: number[],
  ): SeedPlan {
    return buildSeedPlan(this.getSeedRows(priceListId, inventoryIds), options);
  }

  /**
   * Applies a seed/revision. Recomputes the plan inside a transaction rather
   * than trusting a plan passed from the renderer, so what is written always
   * matches current data.
   */
  public applySeed(
    priceListId: number,
    options: SeedOptions,
    inventoryIds?: number[],
  ): { applied: number; plan: SeedPlan } {
    const plan = this.previewSeed(priceListId, options, inventoryIds);
    const write = this.db.transaction((changes: typeof plan.changes) => {
      for (const change of changes) {
        this.stmUpsertInventoryPrice.run(
          change.inventoryId,
          priceListId,
          change.to,
        );
      }
      return changes.length;
    });
    return { applied: write(plan.changes), plan };
  }

  /** Attribute keys marked public — the whitelist the public catalog obeys. */
  public getPublicAttributeKeys(): string[] {
    return (this.stmGetPublicAttributeKeys.all() as { key: string }[]).map(
      (r) => r.key,
    );
  }

  public getCatalogRows(
    imageSkus: Set<string> = new Set(),
  ): CatalogSourceRow[] {
    const raw = this.stmGetCatalogRows.all() as RawCatalogRow[];
    return raw.map((row) => mapCatalogRow(row, imageSkus));
  }

  public generateCatalogFiles(
    outDir: string,
    options: GenerateCatalogOptions,
  ): GenerateCatalogResult {
    const rows = this.getCatalogRows(options.imageSkus ?? new Set());
    const generatedAt = options.generatedAt ?? new Date().toISOString();
    const opts = {
      publicPriceList: options.publicPriceList,
      publicAttributeKeys: options.publicAttributeKeys,
    };

    const full = buildFullCatalog(rows, opts, generatedAt);
    const pub = buildPublicCatalog(rows, opts, generatedAt);
    const csv = toProductsCsv(pub);

    fs.mkdirSync(outDir, { recursive: true });
    const files = {
      full: path.join(outDir, 'catalog-full.json'),
      public: path.join(outDir, 'catalog-public.json'),
      csv: path.join(outDir, 'products.csv'),
    };
    // the full catalog stays indented: it is private and the one humans and
    // downstream generators read. public files are minified because consumers
    // (storefronts, ad feeds) refetch them repeatedly — ~33% smaller.
    fs.writeFileSync(files.full, JSON.stringify(full, null, 2));
    fs.writeFileSync(files.public, JSON.stringify(pub));
    fs.writeFileSync(files.csv, csv);

    return {
      fullCount: full.count,
      publicCount: pub.count,
      publishableCount: pub.items.filter((i) => i.publishable).length,
      files,
    };
  }

  /**
   * Summarise what a publish would produce, without writing anything — powers
   * the readiness panel in Settings so the user can see why items are excluded.
   */
  public async previewCatalog(options: {
    publicPriceList: string;
    publicAttributeKeys?: readonly string[];
    imagesManifestUrl?: string;
  }): Promise<CatalogPreview> {
    const { skus: imageSkus, error: imagesManifestError } =
      await PublishService.fetchImageSkus(options.imagesManifestUrl);
    const rows = this.getCatalogRows(imageSkus);
    const { publicPriceList, publicAttributeKeys } = options;

    let publicCount = 0;
    let publishableCount = 0;
    let missingImage = 0;
    let missingAttributes = 0;
    let missingPublicPrice = 0;

    for (const row of rows) {
      const hasPublicPrice = publicPriceOf(row, publicPriceList) !== null;
      // counted on public attributes: an item described only by internal keys
      // has nothing to show a customer, which is what this number reports
      const hasAttrs =
        Object.keys(publicAttributesOf(row, publicAttributeKeys)).length > 0;
      if (hasPublicPrice) publicCount += 1;
      else missingPublicPrice += 1;
      if (!hasAttrs) missingAttributes += 1;
      if (!row.hasImage) missingImage += 1;
      if (isPublishable(row, publicPriceList, publicAttributeKeys))
        publishableCount += 1;
    }

    return {
      candidateCount: rows.length,
      publicCount,
      publishableCount,
      missingImage,
      missingAttributes,
      missingPublicPrice,
      ...(imagesManifestError ? { imagesManifestError } : {}),
    };
  }

  /**
   * Full publish run: generate the catalog files, upload them to the
   * configured S3-compatible endpoint (full catalog to the private prefix,
   * public catalog + CSV to the public prefix), then optionally notify a
   * webhook. Progress is emitted to all windows as it goes.
   */
  public async publish(force = false): Promise<PublishResult> {
    const generatedAt = new Date().toISOString();
    const config = getPublishConfig();

    const missing = validatePublishConfig(config);
    if (missing.length > 0) {
      return PublishService.fail(
        `Publish is not configured yet — still needed: ${missing.join(', ')}.`,
        generatedAt,
      );
    }

    const unsafe = unsafeTargetReason(config);
    if (unsafe) {
      return PublishService.fail(unsafe, generatedAt);
    }

    try {
      PublishService.emitProgress('generating', 'Generating catalog files…');
      const { skus: imageSkus } = await PublishService.fetchImageSkus(
        config.imagesManifestUrl,
      );
      const outDir = path.join(app.getPath('userData'), 'publish');
      const generated = this.generateCatalogFiles(outDir, {
        publicPriceList: config.publicPriceList,
        publicAttributeKeys: this.getPublicAttributeKeys(),
        imageSkus,
        generatedAt,
      });

      // an unchanged catalog needs no re-upload: skip it to avoid pointless
      // cache invalidation on consumer CDNs (force=true bypasses this)
      const fingerprint = contentFingerprint({
        full: fs.readFileSync(generated.files.full, 'utf-8'),
        public: fs.readFileSync(generated.files.public, 'utf-8'),
        csv: fs.readFileSync(generated.files.csv, 'utf-8'),
      });
      const previous = PublishService.getLastResult();
      if (!force && previous?.ok && previous.fingerprint === fingerprint) {
        const unchanged: PublishResult = {
          ...previous,
          generatedAt,
          skipped: true,
        };
        store.set(PUBLISH_KEYS.lastResult, unchanged);
        PublishService.emitProgress(
          'success',
          'No catalog changes since the last publish — nothing uploaded.',
        );
        return unchanged;
      }

      const { secretAccessKey, webhookToken } = getPublishSecrets();
      // loaded on demand: the SDK is large, and nothing else in the app needs
      // it, so keep it out of the startup module graph
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const client = new S3Client({
        endpoint: config.endpoint,
        region: config.region || 'auto',
        // path-style keeps every bucket on the one endpoint host
        // (endpoint/bucket/key). The default virtual-hosted style would put the
        // bucket in the hostname, which needs per-bucket DNS and fails with
        // ENOTFOUND on providers that do not publish it.
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey,
        },
      });

      const targets = buildPublishTargets(config);
      const uploaded: string[] = [];
      for (const target of targets) {
        PublishService.emitProgress('uploading', `Uploading ${target.key}…`);
        // sequential: the file set is tiny and ordering keeps logs readable
        // eslint-disable-next-line no-await-in-loop
        await client.send(
          new PutObjectCommand({
            Bucket: target.bucket,
            Key: target.key,
            Body: fs.readFileSync(path.join(outDir, target.fileName)),
            ContentType: target.contentType,
          }),
        );
        uploaded.push(`${target.bucket}/${target.key}`);
      }

      // only meaningful when the private file shares the published bucket; a
      // dedicated private bucket is not reachable via the public base URL
      const privateTarget = targets.find((t) => !t.isPublic);
      const sharesPublicBucket = privateTarget?.bucket === config.bucket;
      const privateExposureWarning = sharesPublicBucket
        ? await PublishService.checkPrivateExposure(
            config.publicBaseUrl,
            privateTarget?.key,
          )
        : undefined;

      const webhook = await PublishService.callWebhook(
        config.webhookUrl,
        webhookToken,
        { generatedAt, publishableCount: generated.publishableCount },
      );

      const result: PublishResult = {
        ok: true,
        generatedAt,
        fullCount: generated.fullCount,
        publicCount: generated.publicCount,
        publishableCount: generated.publishableCount,
        uploaded,
        webhook,
        fingerprint,
        skipped: false,
        ...(privateExposureWarning ? { privateExposureWarning } : {}),
      };
      store.set(PUBLISH_KEYS.lastResult, result);
      PublishService.emitProgress(
        'success',
        `Published ${generated.publishableCount} item(s).`,
      );
      return result;
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown error';
      log.error('Publish failed', error);
      return PublishService.fail(message, generatedAt);
    }
  }

  private static fail(error: string, generatedAt: string): PublishResult {
    PublishService.emitProgress('error', error);
    const result: PublishResult = {
      ok: false,
      error,
      generatedAt,
      fullCount: 0,
      publicCount: 0,
      publishableCount: 0,
      uploaded: [],
    };
    store.set(PUBLISH_KEYS.lastResult, result);
    return result;
  }

  /** The most recent publish outcome, for display in settings. */
  public static getLastResult(): PublishResult | null {
    const value = store.get(PUBLISH_KEYS.lastResult);
    return value ? (value as PublishResult) : null;
  }

  private static emitProgress(
    status: PublishProgressStatus,
    message: string,
  ): void {
    const event: PublishProgressEvent = { status, message };
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('publish-progress', event);
      }
    });
    log.info(`Publish progress: ${status} - ${message}`);
  }

  /**
   * After uploading, confirm the private catalog is NOT readable over the
   * public base URL. A bucket exposed at its root would serve the private
   * prefix too, quietly defeating the private/public split — the user needs to
   * know immediately, since that file carries every price list.
   *
   * Returns a warning message when it IS reachable, otherwise undefined.
   */
  private static async checkPrivateExposure(
    publicBaseUrl: string,
    privateKey?: string,
  ): Promise<string | undefined> {
    if (!publicBaseUrl || !privateKey) return undefined;
    const url = `${publicBaseUrl.replace(/\/+$/, '')}/${privateKey}`;
    try {
      // a 1-byte ranged GET proves readability without downloading the whole
      // catalog, and works on hosts that reject HEAD
      const response = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
      });
      if (response.ok || response.status === 206) {
        log.error(`Publish: private catalog is publicly readable at ${url}`);
        return `The full catalog is publicly readable at ${url}. It contains every price list. Restrict public access to the public path prefix only, or use a separate private bucket.`;
      }
      return undefined;
    } catch {
      // network failure here says nothing about exposure — stay quiet
      return undefined;
    }
  }

  /**
   * Notifies the configured webhook that a publish completed. A failure here
   * does not fail the publish itself — the files are already uploaded.
   */
  private static async callWebhook(
    url: string,
    token: string,
    payload: Record<string, unknown>,
  ): Promise<PublishResult['webhook']> {
    if (!url) return { called: false, ok: true };
    PublishService.emitProgress('notifying', 'Notifying webhook…');
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
        log.warn(`Publish webhook returned ${response.status}`);
      }
      return { called: true, ok: response.ok, status: response.status };
    } catch (error) {
      const message = (error as Error)?.message ?? 'unknown error';
      log.warn('Publish webhook failed', error);
      return { called: true, ok: false, error: message };
    }
  }

  /**
   * SKUs that have imagery, per an images manifest published by the image
   * pipeline. Shape: { skus: { [sku]: ... } }. Failure to fetch is not fatal —
   * it just means nothing is considered to have an image.
   */
  private static async fetchImageSkus(
    url?: string,
  ): Promise<{ skus: Set<string>; error?: string }> {
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
        log.warn(`Publish: ${error}`);
        return { skus: new Set(), error };
      }
      const manifest = (await response.json()) as {
        skus?: Record<string, unknown>;
      };
      const skus = new Set(Object.keys(manifest?.skus ?? {}));
      if (skus.size === 0) {
        return { skus, error: 'The images manifest lists no images.' };
      }
      return { skus };
    } catch (error) {
      const message = `Could not read the images manifest: ${
        (error as Error)?.message ?? 'unknown error'
      }`;
      log.warn(`Publish: ${message}`);
      return { skus: new Set(), error: message };
    }
  }
}
