/**
 * QR / copy-link "Add a device" join deep-link.
 *
 * Shape: `https://<app>/#join=<base64url({u,k})>` where `u` is the
 * Supabase project URL and `k` is the anon public API key. The payload
 * lives in the URL **fragment** (`#...`) so it is never sent to the
 * hosting server (Cloudflare Pages, vite preview, etc.) — only this
 * origin's JavaScript ever sees it. `consumeJoinHashFromWindow` then
 * `history.replaceState`s the fragment away so a later screenshot,
 * copied address bar, or Referer header cannot leak it.
 *
 * The parsed invite is also written to `sessionStorage` *before* the
 * fragment is scrubbed. The web PWA's service worker (`skipWaiting` +
 * `clientsClaim` + vite-plugin-pwa `autoUpdate`) reloads the page as
 * soon as it takes control; that reload hits the now-hashless URL and
 * would otherwise land on an empty Join form. sessionStorage survives
 * that reload. An inline script in `apps/web/index.html` captures the
 * raw hash even earlier, before this module loads.
 *
 * Encoding is deliberately tiny and dependency-free (base64url) so this
 * module is safe to import from both the web worker app and the root Jest
 * program. Prefer `Buffer` when it exists (Node/jsdom); otherwise
 * `btoa`/`atob` (browsers). QR *rendering* is a separate, web-only concern
 * (`window.electron.renderJoinQr` — apps/web's electronShim).
 */

export interface JoinInvite {
  url: string;
  anonKey: string;
}

/** Fragment prefix, including `#`. `window.location.hash` matches this. */
export const JOIN_HASH_PREFIX = '#join=';

/**
 * Raw `#join=...` fragment, captured by `apps/web/index.html` before the
 * bundle runs. Keep the string in lockstep with that inline script.
 */
export const JOIN_HASH_SESSION_KEY = 'easyAccounting.joinHash';

/** Parsed `{url, anonKey}` so a reload after scrub still prefills Join. */
export const JOIN_INVITE_SESSION_KEY = 'easyAccounting.joinInvite';

function toBase64Url(utf8: string): string {
  const b64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(utf8, 'utf8').toString('base64')
      : btoa(utf8);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(token: string): string | null {
  const padded = token.replace(/-/g, '+').replace(/_/g, '/');
  const pad =
    padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  try {
    const b64 = padded + pad;
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(b64, 'base64').toString('utf8');
    }
    return atob(b64);
  } catch {
    return null;
  }
}

/**
 * The `#join=<token>` fragment (leading `#` included) for an invite.
 * Pair with {@link buildJoinLink} when you have an origin.
 */
export function encodeJoinHash(invite: JoinInvite): string {
  const json = JSON.stringify({ u: invite.url, k: invite.anonKey });
  return `${JOIN_HASH_PREFIX}${toBase64Url(json)}`;
}

/**
 * Absolute join URL for this origin. `origin` is `window.location.origin`
 * (no trailing slash). Result looks like `https://app.example/#join=...`.
 */
export function buildJoinLink(origin: string, invite: JoinInvite): string {
  const url = new URL(origin);
  url.hash = encodeJoinHash(invite).slice(1); // URL.hash setter re-adds `#`
  return url.toString();
}

/**
 * True when a phone cannot open this origin (localhost / 127.0.0.1 / ::1).
 * Add-a-device QRs must not encode these — the scanner is on another
 * machine. See {@link resolveJoinOrigin}.
 */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(
      origin.includes('://') ? origin : `http://${origin}`,
    );
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1' ||
      hostname.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

/**
 * An https origin a phone can actually open, or null. Rejects loopback
 * and non-https — those are not joinable from a camera.
 */
export function parsePublicOrigin(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:') return null;
    if (isLoopbackOrigin(url.origin)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Origin to encode into the Add-a-device QR. A non-loopback current
 * origin always wins (the hosted app). On localhost, use a previously
 * saved public origin so the QR is something a phone can open — never a
 * baked-in host; the user types the URL phones should open.
 */
export function resolveJoinOrigin(
  currentOrigin: string,
  storedPublicOrigin?: string | null,
): string | null {
  if (!isLoopbackOrigin(currentOrigin)) return currentOrigin;
  return parsePublicOrigin(storedPublicOrigin ?? '');
}

function inviteFromPayload(json: string): JoinInvite | null {
  try {
    const parsed = JSON.parse(json) as { u?: unknown; k?: unknown };
    if (typeof parsed.u !== 'string' || typeof parsed.k !== 'string') {
      return null;
    }
    const url = parsed.u.trim();
    const anonKey = parsed.k.trim();
    if (!url || !anonKey) return null;
    if (!/^https:\/\//i.test(url)) return null;
    return { url, anonKey };
  } catch {
    return null;
  }
}

/**
 * Decode the base64url token from a `#join=` fragment. Tries the token
 * as-is and `decodeURIComponent`'d — some mobile browsers percent-encode
 * the fragment.
 */
export function parseJoinToken(token: string): JoinInvite | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const candidates = [trimmed];
  try {
    const decoded = decodeURIComponent(trimmed);
    if (decoded !== trimmed) candidates.push(decoded);
  } catch {
    // Token wasn't percent-encoded (or was truncated mid-%XX).
  }
  for (const candidate of candidates) {
    const json = fromBase64Url(candidate);
    if (!json) continue;
    const invite = inviteFromPayload(json);
    if (invite) return invite;
  }
  return null;
}

/**
 * Inverse of {@link encodeJoinHash}. Returns null for anything that is
 * not a well-formed invite: missing prefix, bad base64, missing/empty
 * `u`/`k`, or a non-https URL (the join form only ever talks to
 * `https://*.supabase.co` — a `mock://` or `http://` payload is junk,
 * never a real invite, and must not prefill the form).
 */
export function parseJoinHash(hash: string): JoinInvite | null {
  const raw = hash.trim();
  if (raw.startsWith(JOIN_HASH_PREFIX)) {
    return parseJoinToken(raw.slice(JOIN_HASH_PREFIX.length));
  }
  // HashRouter-style `#/join=` — not what we write, but phones have
  // produced it when a scanner or in-app browser rewrote the fragment.
  if (raw.startsWith('#/join=')) {
    return parseJoinToken(raw.slice('#/join='.length));
  }
  return null;
}

function readSession(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Private mode / quota — join still works if the hash is still on
    // the URL for this load; a later SW reload may drop it.
  }
}

function removeSession(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function isJoinHash(hash: string): boolean {
  return hash.startsWith(JOIN_HASH_PREFIX) || hash.startsWith('#/join=');
}

/**
 * Parsed invite previously stashed for this tab, or null.
 * JoinSync uses this when MemoryRouter state is empty (Login → Join
 * after a service-worker reload that dropped `#join=`).
 */
export function readStashedJoinInvite(): JoinInvite | null {
  const raw = readSession(JOIN_INVITE_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as JoinInvite;
    if (
      typeof parsed?.url !== 'string' ||
      typeof parsed?.anonKey !== 'string'
    ) {
      return null;
    }
    const url = parsed.url.trim();
    const anonKey = parsed.anonKey.trim();
    if (!url || !anonKey) return null;
    if (!/^https:\/\//i.test(url)) return null;
    return { url, anonKey };
  } catch {
    return null;
  }
}

/** Drop the stashed invite (after a successful join or a local sign-in). */
export function clearStashedJoinInvite(): void {
  removeSession(JOIN_INVITE_SESSION_KEY);
  removeSession(JOIN_HASH_SESSION_KEY);
}

/**
 * Parse `window.location.hash` (and any hash the index.html inline script
 * already copied into sessionStorage), stash the invite, then drop the
 * fragment from the address bar even if parsing failed (a malformed
 * `#join=` still shouldn't linger). Safe to call from a `useState`
 * initializer or at module load — it touches `window` only, never React.
 * Idempotent: a later call after the fragment is gone still returns the
 * stashed invite, which is what a service-worker reload needs.
 */
export function consumeJoinHashFromWindow(): JoinInvite | null {
  if (typeof window === 'undefined') return null;
  const { hash } = window.location;
  if (isJoinHash(hash)) {
    writeSession(JOIN_HASH_SESSION_KEY, hash);
  }

  const storedHash = readSession(JOIN_HASH_SESSION_KEY);
  const invite =
    parseJoinHash(hash) ??
    (storedHash ? parseJoinHash(storedHash) : null) ??
    readStashedJoinInvite();

  if (invite) {
    writeSession(JOIN_INVITE_SESSION_KEY, JSON.stringify(invite));
  }

  if (isJoinHash(hash)) {
    const next = `${window.location.pathname}${window.location.search}` || '/';
    window.history.replaceState(window.history.state, '', next);
  }
  return invite;
}
