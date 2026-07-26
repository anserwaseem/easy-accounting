import fs from 'fs';
import path from 'path';
import type { Database, Statement } from 'better-sqlite3';
import log from 'electron-log';
import { logErrors } from '../errorLogger';
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

/**
 * Produces the catalog export files from the accounting DB. Generic: it emits
 * inventory + attributes (by their generic keys) + named price lists, and
 * enforces tier separation structurally via the pure builders in ../utils/catalog.
 *
 * Stage 1 writes the three files to a local directory. Uploading to the
 * configured S3 endpoint and firing the publish webhook are wired in later.
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
