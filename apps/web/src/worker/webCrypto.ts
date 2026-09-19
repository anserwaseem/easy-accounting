/**
 * Password hashing for the web worker's auth:* handlers, using WebCrypto's
 * `SubtleCrypto` (available in both window and worker global scopes — the
 * "DOM" lib apps/web's tsconfig already includes types it, so no extra
 * ambient declarations are needed here, unlike db.worker.ts's WorkerScope
 * shim for `self`/`postMessage`).
 *
 * This is deliberately a *different* format from the desktop path
 * (src/main/utils/encrypt.ts, which uses Node's `crypto.pbkdf2Sync` with
 * SHA-512 and 1000 iterations): Node's `crypto` module cannot be imported
 * into a browser bundle, so the algorithm has to be reimplemented against
 * WebCrypto rather than shared. Rather than silently produce a same-looking
 * `salt:hash` hex string that is actually incompatible (verifying a desktop
 * hash here, or vice versa, would silently fail or — worse — coincidentally
 * "work" for some inputs), this format is versioned and self-describing
 * (`webpbkdf2$<iterations>$<saltB64>$<hashB64>`) so the two are never
 * confusable and a verifier can reject a foreign format cleanly.
 *
 * Desktop-import compatibility: `verifyDesktopPassword` below covers the
 * "carry both hash formats and dispatch on prefix" option this comment used
 * to leave open. It turned out feasible rather than merely theoretical:
 * src/main/utils/encrypt.ts hashes with Node's `crypto.pbkdf2Sync(password,
 * salt, 1000, 64, 'sha512')` and stores `${salt}:${hash}` as two hex
 * strings — PBKDF2 with SHA-512, a fixed iteration count and key length,
 * nothing Node-specific about the algorithm ITSELF. There is one
 * Node-specific-looking quirk in how it's *called*, worth flagging because
 * it is easy to silently get wrong: `salt` there is already
 * `crypto.randomBytes(16).toString('hex')` (a 32-character hex STRING) by
 * the time it reaches `pbkdf2Sync` — so the actual PBKDF2 salt input is the
 * 32 ASCII bytes of that hex string, not the 16 raw bytes it represents.
 * `verifyDesktopPassword` below reproduces that exactly (`TextEncoder`
 * over the hex string, not a hex-decode of it) — verified empirically
 * against Node's own `crypto.pbkdf2Sync`/`crypto.webcrypto.subtle`, not
 * assumed from reading encrypt.ts alone, since decoding the hex first
 * looks equally plausible and produces a different, wrong digest. Once
 * that's accounted for, WebCrypto's own PBKDF2 (`crypto.subtle.deriveBits`)
 * accepts `hash: 'SHA-512'` and an arbitrary iteration count/output length,
 * so the same derivation reproduces byte-for-byte in a Worker with no
 * native module involved. That made a
 * "verify the desktop hash directly" import path strictly better than a
 * "mark the user as needing a new password" one — no user has to be
 * bothered post-import for a case WebCrypto can already check — so that's
 * what apps/web/src/worker/db.worker.ts's `login` handler does with it: try
 * this app's own `webpbkdf2$`-prefixed format first via `verifyPassword`
 * below, then fall back to `verifyDesktopPassword` for a `salt:hash` hex
 * pair a "bring your database" import (src/core/db/import.ts) carried over
 * unchanged. A desktop-format hash is never *re-hashed* into the web format
 * on successful login — it stays exactly as imported, verifiable the same
 * way on every subsequent login, which also means it stays exactly as
 * capable of being verified back on the desktop app should the same
 * `users` row ever travel the other way.
 *
 * Iteration count: 100,000, per OWASP's current PBKDF2-HMAC-SHA256
 * recommendation (https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
 * — far higher than the desktop path's 1000 (a pre-existing weakness on that
 * side, not replicated here since this is a fresh format with no compatibility
 * constraint pulling it down).
 */

const FORMAT_PREFIX = 'webpbkdf2';
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveBits(
  password: string,
  salt: Uint8Array,
  iterations: number,
  hashAlg: 'SHA-256' | 'SHA-512' = 'SHA-256',
  bits: number = HASH_BITS,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: hashAlg },
    keyMaterial,
    bits,
  );
  return new Uint8Array(derived);
}

/** Constant-time-ish byte comparison — XORs every byte rather than short-circuiting, so verification time doesn't leak how many leading bytes matched. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Desktop hash shape from src/main/utils/encrypt.ts: `${saltHex}:${hashHex}`,
 * a 16-byte (32 hex char) salt and a 64-byte (128 hex char) PBKDF2-SHA512
 * digest, both lowercase-or-uppercase hex. Checked structurally (not just
 * "contains a colon") so an unrelated string that happens to contain one
 * doesn't get misrouted into a PBKDF2 run.
 */
const DESKTOP_HASH_PATTERN = /^[0-9a-fA-F]{32}:[0-9a-fA-F]{128}$/;

export function isUsablePasswordHash(
  storedHash: string | null | undefined,
): boolean {
  if (!storedHash) return false;
  return (
    storedHash.startsWith(`${FORMAT_PREFIX}$`) ||
    isDesktopFormatHash(storedHash)
  );
}

/**
 * sqlite-wasm returns declared-BLOB columns (`users.password_hash`) as
 * `Uint8Array` even when the stored bytes are ASCII (`webpbkdf2$...` or
 * desktop `saltHex:hashHex`). Passing that object into `.split` throws;
 * treating it as "no hash" made Login always fail after logout.
 */
export function coerceStoredPasswordHash(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (value instanceof Uint8Array) {
    if (value.byteLength === 0) return null;
    return new TextDecoder('utf-8', { fatal: false }).decode(value);
  }
  if (value instanceof ArrayBuffer) {
    return coerceStoredPasswordHash(new Uint8Array(value));
  }
  return null;
}
export function isDesktopFormatHash(
  storedHash: string | null | undefined,
): boolean {
  return !!storedHash && DESKTOP_HASH_PATTERN.test(storedHash);
}

/**
 * Verifies a password against a desktop-format hash (`${saltHex}:${hashHex}`,
 * PBKDF2-HMAC-SHA512, 1000 iterations, 64-byte digest — see
 * src/main/utils/encrypt.ts, reproduced here via WebCrypto; see this file's
 * doc comment for why that's exact, not approximate). Used for a `users` row
 * carried over unchanged by a "bring your database" import
 * (src/core/db/import.ts) — see db.worker.ts's `login` handler.
 *
 * Salt quirk (verified empirically against Node, not assumed): encrypt.ts's
 * `hashPassword` calls `crypto.randomBytes(16).toString('hex')` for the
 * salt, then passes THAT HEX STRING straight into `pbkdf2Sync(password,
 * salt, ...)` as the salt argument — Node hashes the 32 ASCII bytes of the
 * hex string itself, not the 16 raw bytes it represents. So the salt this
 * function must feed into PBKDF2 is the UTF-8 encoding of `saltHex` (32
 * bytes), NOT `fromHex(saltHex)` (16 bytes) — the latter reproduces a
 * different, wrong digest that happens to look equally plausible.
 */
export async function verifyDesktopPassword(
  inputPassword: string,
  storedHash: string,
): Promise<boolean> {
  if (!isDesktopFormatHash(storedHash)) return false;
  const [saltHex, hashHex] = storedHash.split(':');
  const salt = new TextEncoder().encode(saltHex);
  const expected = fromHex(hashHex);
  // src/main/utils/encrypt.ts: pbkdf2Sync(password, saltHex, 1000, 64, 'sha512')
  const actual = await deriveBits(inputPassword, salt, 1000, 'SHA-512', 64 * 8);
  return bytesEqual(actual, expected);
}

/** Hashes a password into the `webpbkdf2$<iterations>$<saltB64>$<hashB64>` format documented above. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveBits(password, salt, ITERATIONS);
  return `${FORMAT_PREFIX}$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/**
 * Verifies a password against a stored hash produced by `hashPassword`.
 * Returns false (rather than throwing) for a hash in a foreign/unrecognized
 * format — e.g. a desktop `salt:hash` hex pair, or a placeholder `null` —
 * since "not a password this build can verify" is a verification failure,
 * not a crash.
 */
export async function verifyPassword(
  inputPassword: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== FORMAT_PREFIX) return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = fromBase64(parts[2]);
  const expected = fromBase64(parts[3]);
  const actual = await deriveBits(inputPassword, salt, iterations);
  return bytesEqual(actual, expected);
}
