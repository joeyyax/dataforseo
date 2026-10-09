import { describe, it, expect } from 'vitest';
import { createDataForSeoClient, createHttpCacheStore } from './index.js';

const KEY = 'a'.repeat(64);
const URL_BASE = 'https://cache.test/api/dataforseo/cache';

type Call = { url: string; init?: RequestInit };

function server(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe('createHttpCacheStore', () => {
  it('gets and puts with the bearer token', async () => {
    const stored = new Map<string, string>();
    const { calls, fetchFn } = server(({ url, init }) => {
      const key = url.split('/').pop()!;
      if (init?.method === 'PUT') { stored.set(key, String(init.body)); return new Response(null, { status: 204 }); }
      const hit = stored.get(key);
      return hit ? new Response(JSON.stringify({ value: JSON.parse(hit).value })) : new Response('{}', { status: 404 });
    });
    const store = createHttpCacheStore({ url: `${URL_BASE}/`, token: 't0k', fetchFn });
    expect(await store.get(KEY)).toBeNull();
    await store.set(KEY, { n: 1 }, 60_000);
    expect(await store.get(KEY)).toEqual({ n: 1 });
    expect(calls[0]!.url).toBe(`${URL_BASE}/${KEY}`);
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({ value: { n: 1 }, ttl_ms: 60_000 });
    expect(calls.every((c) => (c.init!.headers as Record<string, string>).authorization === 'Bearer t0k')).toBe(true);
  });

  it('throws on 5xx and 401 so the client treats them as a miss', async () => {
    const store = createHttpCacheStore({ url: URL_BASE, token: 't', fetchFn: server(() => new Response('', { status: 502 })).fetchFn });
    await expect(store.get(KEY)).rejects.toThrow('HTTP 502');
    const denied = createHttpCacheStore({ url: URL_BASE, token: 't', fetchFn: server(() => new Response('', { status: 401 })).fetchFn });
    await expect(denied.set(KEY, 1, 1)).rejects.toThrow('HTTP 401');
  });

  it('rejects keys that are not cache digests before calling out', async () => {
    const { calls, fetchFn } = server(() => new Response('{}'));
    await expect(createHttpCacheStore({ url: URL_BASE, token: 't', fetchFn }).get('../x')).rejects.toThrow('Invalid cache key');
    expect(calls).toHaveLength(0);
  });

  it('times out', async () => {
    const fetchFn = ((_: string, init?: RequestInit) => new Promise((_, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
    })) as unknown as typeof fetch;
    await expect(createHttpCacheStore({ url: URL_BASE, token: 't', getTimeoutMs: 10, fetchFn }).get(KEY)).rejects.toThrow();
  });

  it('falls through to a live call and logs when the cache is down', async () => {
    const errors: string[] = [];
    let live = 0;
    const cache = createHttpCacheStore({ url: URL_BASE, token: 't', fetchFn: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
    const client = createDataForSeoClient({
      login: 'a', password: 'b', cache,
      onCacheError: (op) => { errors.push(op); },
      fetchFn: (async () => { live++; return new Response(JSON.stringify({ status_code: 20000, cost: 0.01, tasks: [{ status_code: 20000, result: [{}] }] })); }) as unknown as typeof fetch,
    });
    await expect(client.live('/x/live', {})).resolves.toMatchObject({ cached: false, cost: 0.01 });
    expect(live).toBe(1);
    expect(errors).toEqual(['get', 'set']);
  });
});
