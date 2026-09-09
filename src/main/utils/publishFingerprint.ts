import { createHash } from 'crypto';

/**
 * Stable fingerprint of what a publish would upload, ignoring the timestamp so
 * an unchanged catalog produces an unchanged hash. Used to skip re-uploading
 * identical content (avoids pointless cache churn on consumer CDNs).
 *
 * Lives in its own module (not publishTargets.ts) so the PWA worker can import
 * the target-layout helpers without pulling Node `crypto` into the browser
 * bundle. The worker has an async Web Crypto twin that must hash the same
 * concatenated UTF-8 bytes.
 */
export function contentFingerprint(payloads: {
  full: string;
  public: string;
  csv: string;
}): string {
  const strip = (json: string): string =>
    json.replace(/"generatedAt"\s*:\s*("[^"]*"|null)/g, '"generatedAt":null');
  return createHash('sha256')
    .update(strip(payloads.full))
    .update(strip(payloads.public))
    .update(payloads.csv)
    .digest('hex');
}
