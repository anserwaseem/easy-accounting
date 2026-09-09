import {
  buildJoinLink,
  clearStashedJoinInvite,
  consumeJoinHashFromWindow,
  encodeJoinHash,
  isLoopbackOrigin,
  JOIN_HASH_PREFIX,
  JOIN_HASH_SESSION_KEY,
  JOIN_INVITE_SESSION_KEY,
  parseJoinHash,
  parsePublicOrigin,
  readStashedJoinInvite,
  resolveJoinOrigin,
} from '../joinLink';

describe('joinLink', () => {
  const invite = {
    url: 'https://abcd.supabase.co',
    anonKey: 'eyJhbGciOi.unpadded/plus+chars=',
  };

  afterEach(() => {
    clearStashedJoinInvite();
    window.history.replaceState(null, '', '/');
  });

  it('round-trips a real-looking url + anon key', () => {
    const hash = encodeJoinHash(invite);
    expect(hash.startsWith(JOIN_HASH_PREFIX)).toBe(true);
    expect(parseJoinHash(hash)).toEqual(invite);
  });

  it('buildJoinLink puts the payload in the fragment, never the path or query', () => {
    const link = buildJoinLink('https://app.example.com', invite);
    const parsed = new URL(link);
    expect(parsed.origin).toBe('https://app.example.com');
    expect(parsed.pathname).toBe('/');
    expect(parsed.search).toBe('');
    expect(parsed.hash.startsWith(JOIN_HASH_PREFIX)).toBe(true);
    expect(parseJoinHash(parsed.hash)).toEqual(invite);
    // The fragment is not part of what a server sees on the request line.
    expect(link.includes('anonKey')).toBe(false);
    expect(link.includes(invite.anonKey)).toBe(false);
  });

  it('rejects missing prefix, garbage, empty fields, and non-https urls', () => {
    expect(parseJoinHash('')).toBeNull();
    expect(parseJoinHash('#other=abc')).toBeNull();
    expect(parseJoinHash(`${JOIN_HASH_PREFIX}%%%`)).toBeNull();
    expect(parseJoinHash(encodeJoinHash({ url: '', anonKey: 'x' }))).toBeNull();
    expect(
      parseJoinHash(
        encodeJoinHash({ url: 'http://insecure.example', anonKey: 'x' }),
      ),
    ).toBeNull();
    expect(
      parseJoinHash(encodeJoinHash({ url: 'mock://local', anonKey: 'x' })),
    ).toBeNull();
  });

  it('consumeJoinHashFromWindow parses then scrubs the fragment', () => {
    const hash = encodeJoinHash(invite);
    window.history.replaceState(null, '', `/${hash}`);
    expect(window.location.hash).toBe(hash);

    const got = consumeJoinHashFromWindow();
    expect(got).toEqual(invite);
    expect(window.location.hash).toBe('');
    expect(readStashedJoinInvite()).toEqual(invite);

    // A second consume still returns the invite — the fragment is gone but
    // sessionStorage survives a service-worker reload of the hashless URL.
    expect(consumeJoinHashFromWindow()).toEqual(invite);
  });

  it('survives a reload that drops the fragment (SW autoUpdate)', () => {
    const hash = encodeJoinHash(invite);
    window.sessionStorage.setItem(JOIN_HASH_SESSION_KEY, hash);
    window.history.replaceState(null, '', '/');
    expect(window.location.hash).toBe('');

    expect(consumeJoinHashFromWindow()).toEqual(invite);
    expect(window.sessionStorage.getItem(JOIN_INVITE_SESSION_KEY)).toBe(
      JSON.stringify(invite),
    );
  });

  it('parses a percent-encoded fragment token', () => {
    const hash = encodeJoinHash(invite);
    const token = hash.slice(JOIN_HASH_PREFIX.length);
    const encoded = `${JOIN_HASH_PREFIX}${encodeURIComponent(token)}`;
    expect(parseJoinHash(encoded)).toEqual(invite);
  });

  it('scrubs a malformed #join= fragment rather than leaving it in the bar', () => {
    window.history.replaceState(null, '', '/#join=not-valid');
    expect(consumeJoinHashFromWindow()).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('treats localhost / 127.0.0.1 as loopback and prefers a stored https origin', () => {
    expect(isLoopbackOrigin('http://127.0.0.1:4173')).toBe(true);
    expect(isLoopbackOrigin('http://localhost:4173')).toBe(true);
    expect(
      isLoopbackOrigin('https://easy-accounting-web.ansercrypto.workers.dev'),
    ).toBe(false);
    expect(parsePublicOrigin('http://insecure.example')).toBeNull();
    expect(parsePublicOrigin('https://127.0.0.1')).toBeNull();
    expect(
      parsePublicOrigin('https://easy-accounting-web.ansercrypto.workers.dev/'),
    ).toBe('https://easy-accounting-web.ansercrypto.workers.dev');
    expect(
      resolveJoinOrigin(
        'http://127.0.0.1:4173',
        'https://easy-accounting-web.ansercrypto.workers.dev',
      ),
    ).toBe('https://easy-accounting-web.ansercrypto.workers.dev');
    expect(resolveJoinOrigin('http://127.0.0.1:4173', null)).toBeNull();
    expect(
      resolveJoinOrigin('https://app.example.com', 'https://other.example'),
    ).toBe('https://app.example.com');
  });
});
