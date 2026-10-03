/**
 * same-origin Jameel print face. only `/fonts/jameel-noori-nastaleeq.woff2`
 * hits this script (`run_worker_first`); the rest of the PWA stays assets-only.
 * object lives in R2 so the 10MB woff2 is never in vite dist or the SW precache.
 */
const JAMEEL_PATH = '/fonts/jameel-noori-nastaleeq.woff2';
const JAMEEL_KEY = 'jameel-noori-nastaleeq.woff2';

const fontHeaders = (etag: string): Headers => {
  const headers = new Headers();
  headers.set('content-type', 'font/woff2');
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('cross-origin-resource-policy', 'same-origin');
  headers.set('etag', etag);
  return headers;
};

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== JAMEEL_PATH) {
      return new Response('Not found', { status: 404 });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, {
        status: 405,
        headers: { allow: 'GET, HEAD' },
      });
    }

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    const cached = await cache.match(cacheKey);
    if (cached) {
      return request.method === 'HEAD' ? new Response(null, cached) : cached;
    }

    if (request.method === 'HEAD') {
      const meta = await env.FONTS.head(JAMEEL_KEY);
      if (!meta) {
        return new Response(null, { status: 404 });
      }
      return new Response(null, { headers: fontHeaders(meta.httpEtag) });
    }

    const object = await env.FONTS.get(JAMEEL_KEY);
    if (!object) {
      return new Response('Not found', { status: 404 });
    }

    const response = new Response(object.body, {
      headers: fontHeaders(object.httpEtag),
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
} satisfies ExportedHandler<Env>;
