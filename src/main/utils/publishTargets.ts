/**
 * Object-key construction for a publish run.
 *
 * Kept pure so the private/public split can be unit-tested: the full catalog
 * must always land under the private prefix, and only the public catalog and
 * CSV under the public prefix. Getting this wrong is the one mistake that
 * would expose non-public prices, so it is derived in one place and asserted.
 */

export type PublishFileKind = 'full' | 'public' | 'csv';

export interface PublishTarget {
  kind: PublishFileKind;
  /** Local file name produced by the catalog generator. */
  fileName: string;
  /** Destination bucket for this object. */
  bucket: string;
  /** Destination object key within the bucket. */
  key: string;
  contentType: string;
  /** Whether this object is intended to be publicly readable. */
  isPublic: boolean;
}

export interface PublishTargetConfig {
  bucket: string;
  /** Optional separate bucket for the full catalog. Empty = use `bucket`. */
  privateBucket?: string;
  privatePrefix: string;
  publicPrefix: string;
}

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, '');

/** Joins a prefix and file name into an object key, tolerating stray slashes. */
export function joinKey(prefix: string, fileName: string): string {
  const cleanPrefix = trimSlashes(prefix);
  return cleanPrefix ? `${cleanPrefix}/${fileName}` : fileName;
}

export function buildPublishTargets(
  config: PublishTargetConfig,
): PublishTarget[] {
  // a dedicated private bucket is preferred: public access on most object
  // stores is bucket-wide, so a prefix alone cannot keep the full catalog private
  const privateBucket = config.privateBucket?.trim() || config.bucket;
  return [
    {
      kind: 'full',
      fileName: 'catalog-full.json',
      bucket: privateBucket,
      key: joinKey(config.privatePrefix, 'catalog-full.json'),
      contentType: 'application/json',
      isPublic: false,
    },
    {
      kind: 'public',
      fileName: 'catalog-public.json',
      bucket: config.bucket,
      key: joinKey(config.publicPrefix, 'catalog-public.json'),
      contentType: 'application/json',
      isPublic: true,
    },
    {
      kind: 'csv',
      fileName: 'products.csv',
      bucket: config.bucket,
      key: joinKey(config.publicPrefix, 'products.csv'),
      contentType: 'text/csv',
      isPublic: true,
    },
  ];
}

/**
 * Guard against a misconfiguration that would publish the full catalog to a
 * public location — e.g. both prefixes set to the same value. Returns a reason
 * when the layout is unsafe, otherwise null.
 */
export function unsafeTargetReason(config: PublishTargetConfig): string | null {
  // a distinct private bucket makes prefix layout irrelevant: the full catalog
  // lives in a bucket that is never published, so nothing can collide with it
  const privateBucket = config.privateBucket?.trim();
  if (privateBucket && privateBucket !== config.bucket.trim()) return null;

  const priv = trimSlashes(config.privatePrefix);
  const pub = trimSlashes(config.publicPrefix);
  if (priv === pub) {
    return 'The private and public path prefixes are the same, so the full catalog would be written alongside public files.';
  }
  // the private prefix must not sit inside the public one
  if (pub !== '' && (priv === pub || priv.startsWith(`${pub}/`))) {
    return 'The private path prefix is inside the public path prefix, so the full catalog would be publicly reachable.';
  }
  if (pub === '' && priv !== '') {
    return 'The public path prefix is the bucket root, which would expose the private folder if the bucket is public.';
  }
  return null;
}
