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
  unsafeTargetReason,
} from '../utils/publishTargets';
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
  publicPricesOf,
  toProductsCsv,
  type CatalogSourceRow,
} from '../utils/catalog';

interface GenerateCatalogOptions {
  /** Names of price lists the business has marked public (e.g. ['Retail']). */
  publicPriceLists: string[];
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

  private stmGetPriceListNames!: Statement;

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.stmGetCatalogRows = this.db.prepare(CATALOG_QUERY);
    this.stmGetPriceListNames = this.db.prepare(
      `SELECT name FROM price_lists WHERE isActive = 1 ORDER BY name`,
    );
  }

  /** Names of the active price lists — drives the "public price lists" picker. */
  public getPriceListNames(): string[] {
    return (this.stmGetPriceListNames.all() as Array<{ name: string }>).map(
      (r) => r.name,
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
    const opts = { publicPriceLists: options.publicPriceLists };

    const full = buildFullCatalog(rows, opts, generatedAt);
    const pub = buildPublicCatalog(rows, opts, generatedAt);
    const csv = toProductsCsv(pub);

    fs.mkdirSync(outDir, { recursive: true });
    const files = {
      full: path.join(outDir, 'catalog-full.json'),
      public: path.join(outDir, 'catalog-public.json'),
      csv: path.join(outDir, 'products.csv'),
    };
    fs.writeFileSync(files.full, JSON.stringify(full, null, 2));
    fs.writeFileSync(files.public, JSON.stringify(pub, null, 2));
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
    publicPriceLists: string[];
    imagesManifestUrl?: string;
  }): Promise<CatalogPreview> {
    const imageSkus = await PublishService.fetchImageSkus(
      options.imagesManifestUrl,
    );
    const rows = this.getCatalogRows(imageSkus);
    const { publicPriceLists } = options;

    let publicCount = 0;
    let publishableCount = 0;
    let missingImage = 0;
    let missingAttributes = 0;
    let missingPublicPrice = 0;

    for (const row of rows) {
      const hasPublicPrice =
        Object.keys(publicPricesOf(row, publicPriceLists)).length > 0;
      const hasAttrs = Object.keys(row.attributes ?? {}).length > 0;
      if (hasPublicPrice) publicCount += 1;
      else missingPublicPrice += 1;
      if (!hasAttrs) missingAttributes += 1;
      if (!row.hasImage) missingImage += 1;
      if (isPublishable(row, publicPriceLists)) publishableCount += 1;
    }

    return {
      candidateCount: rows.length,
      publicCount,
      publishableCount,
      missingImage,
      missingAttributes,
      missingPublicPrice,
    };
  }

  /**
   * Full publish run: generate the catalog files, upload them to the
   * configured S3-compatible endpoint (full catalog to the private prefix,
   * public catalog + CSV to the public prefix), then optionally notify a
   * webhook. Progress is emitted to all windows as it goes.
   */
  public async publish(): Promise<PublishResult> {
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
      const imageSkus = await PublishService.fetchImageSkus(
        config.imagesManifestUrl,
      );
      const outDir = path.join(app.getPath('userData'), 'publish');
      const generated = this.generateCatalogFiles(outDir, {
        publicPriceLists: config.publicPriceLists,
        imageSkus,
        generatedAt,
      });

      const { secretAccessKey, webhookToken } = getPublishSecrets();
      // loaded on demand: the SDK is large, and nothing else in the app needs
      // it, so keep it out of the startup module graph
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const client = new S3Client({
        endpoint: config.endpoint,
        region: config.region || 'auto',
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
            Bucket: config.bucket,
            Key: target.key,
            Body: fs.readFileSync(path.join(outDir, target.fileName)),
            ContentType: target.contentType,
          }),
        );
        uploaded.push(target.key);
      }

      const privateTarget = targets.find((t) => !t.isPublic);
      const privateExposureWarning = await PublishService.checkPrivateExposure(
        config.publicBaseUrl,
        privateTarget?.key,
      );

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
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
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
  private static async fetchImageSkus(url?: string): Promise<Set<string>> {
    if (!url) return new Set();
    try {
      const response = await fetch(url);
      if (!response.ok) {
        log.warn(`Publish: images manifest fetch failed (${response.status})`);
        return new Set();
      }
      const manifest = (await response.json()) as {
        skus?: Record<string, unknown>;
      };
      return new Set(Object.keys(manifest?.skus ?? {}));
    } catch (error) {
      log.warn('Publish: could not read images manifest', error);
      return new Set();
    }
  }
}
