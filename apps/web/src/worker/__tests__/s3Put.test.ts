/**
 * @jest-environment node
 */
import { webcrypto } from 'node:crypto';
import { awsEncode, putS3Object, signedS3PutRequest } from '../s3Put';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

const now = new Date('2026-03-15T12:34:56.000Z');

const base = {
  endpoint: 'https://s3.example.com',
  region: 'auto',
  accessKeyId: 'AKIATEST',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  bucket: 'catalog',
  key: 'catalog/public/products.csv',
  body: 'sku,price\nA,10\n',
  contentType: 'text/csv',
  now,
};

describe('awsEncode', () => {
  it('uppercases percent-encoding and encodes *', () => {
    expect(awsEncode('a*b')).toBe('a%2Ab');
  });

  it('leaves a slash-free catalog key segment unchanged', () => {
    expect(awsEncode('products.csv')).toBe('products.csv');
  });
});

describe('signedS3PutRequest', () => {
  it('uses path-style {endpoint}/{bucket}/{key}', async () => {
    const signed = await signedS3PutRequest(base);
    expect(signed.url.toString()).toBe(
      'https://s3.example.com/catalog/catalog/public/products.csv',
    );
  });

  it('signs a stable Authorization header for a frozen clock', async () => {
    const signed = await signedS3PutRequest(base);
    expect(signed.headers['x-amz-date']).toBe('20260315T123456Z');
    expect(signed.headers.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIATEST\/20260315\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    const again = await signedS3PutRequest(base);
    expect(again.headers.Authorization).toBe(signed.headers.Authorization);
  });

  it('changes the signature when the body changes', async () => {
    const a = await signedS3PutRequest(base);
    const b = await signedS3PutRequest({ ...base, body: 'sku,price\nA,11\n' });
    expect(b.headers.Authorization).not.toBe(a.headers.Authorization);
  });
});

describe('putS3Object', () => {
  it('PUTs the signed request', async () => {
    const fetchImpl = jest.fn(async () => new Response(null, { status: 200 }));
    await putS3Object(base, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('names CORS as the likely cause of a failed fetch', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      putS3Object(base, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/CORS/);
  });

  it('includes the HTTP status when the bucket rejects the PUT', async () => {
    const fetchImpl = jest.fn(
      async () => new Response('AccessDenied', { status: 403 }),
    );
    await expect(
      putS3Object(base, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/HTTP 403/);
  });
});
