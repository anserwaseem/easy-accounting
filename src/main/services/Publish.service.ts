import fs from 'fs';
import path from 'path';
import type { Database, Statement } from 'better-sqlite3';
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

  constructor() {
    this.db = DatabaseService.getInstance().getDatabase();
    this.stmGetCatalogRows = this.db.prepare(CATALOG_QUERY);
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
}
