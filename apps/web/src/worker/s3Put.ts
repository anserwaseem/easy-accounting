/**
 * Path-style S3 PutObject from a Web Worker, signed with AWS Signature
 * Version 4. Replaces `@aws-sdk/client-s3` (which Electron loads on demand
 * in Publish.service.ts) so the PWA does not ship that SDK.
 *
 * Matches the Electron client's `forcePathStyle: true` layout:
 * `{endpoint}/{bucket}/{key}`. The bucket CORS policy must allow PUT from
 * this origin (see docs/web-field-notes.md).
 */

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(data: BufferSource): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

async function hmac(
  key: BufferSource,
  data: BufferSource,
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, data);
}

/**
 * AWS URI-encode one path segment. encodeURIComponent is close; AWS also
 * wants `*` encoded and hex digits uppercased.
 */
export function awsEncode(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => {
    const hex = c.charCodeAt(0).toString(16).toUpperCase();
    return `%${hex.padStart(2, '0')}`;
  });
}

function amzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function describeNetworkFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Failed to fetch|Load failed|NetworkError|CORS/i.test(message)) {
    return `Upload failed (often CORS). Allow PUT from this origin on the bucket. ${message}`;
  }
  return message;
}

export type S3PutOptions = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  key: string;
  body: string;
  contentType: string;
  now?: Date;
};

export type SignedS3Put = {
  url: URL;
  headers: Record<string, string>;
  body: ArrayBuffer;
};

/** Build the signed PUT without talking to the network — used by tests. */
export async function signedS3PutRequest(
  options: S3PutOptions,
): Promise<SignedS3Put> {
  const region = options.region.trim() || 'auto';
  const endpoint = options.endpoint.replace(/\/+$/, '');
  const encodedKey = options.key.split('/').map(awsEncode).join('/');
  const url = new URL(`${endpoint}/${options.bucket}/${encodedKey}`);
  const encoded = encoder.encode(options.body);
  const body = encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
  const payloadHash = await sha256Hex(body);
  const { amzDate: date, dateStamp } = amzDate(options.now ?? new Date());
  const host = url.host;
  const contentType = options.contentType;

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${date}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'PUT',
    url.pathname,
    url.search.startsWith('?') ? url.search.slice(1) : '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    date,
    credentialScope,
    await sha256Hex(encoder.encode(canonicalRequest)),
  ].join('\n');

  const kDate = await hmac(
    encoder.encode(`AWS4${options.secretAccessKey}`),
    encoder.encode(dateStamp),
  );
  const kRegion = await hmac(kDate, encoder.encode(region));
  const kService = await hmac(kRegion, encoder.encode('s3'));
  const kSigning = await hmac(kService, encoder.encode('aws4_request'));
  const signature = toHex(await hmac(kSigning, encoder.encode(stringToSign)));

  return {
    url,
    body,
    headers: {
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': date,
      Authorization: `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

export async function putS3Object(
  options: S3PutOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const signed = await signedS3PutRequest(options);

  let response: Response;
  try {
    response = await fetchImpl(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body: signed.body,
    });
  } catch (error) {
    throw new Error(describeNetworkFailure(error));
  }

  if (!response.ok) {
    const text = (await response.text()).slice(0, 500);
    throw new Error(
      `Upload of ${options.bucket}/${options.key} failed (HTTP ${
        response.status
      })${text ? `: ${text}` : ''}`,
    );
  }
}
