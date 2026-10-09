import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cacheKey, createDataForSeoClient, createDiskCacheStore, dailyBudget, DailyLimitError, DataForSeoError, diffSnapshots, nextUtcMidnight,
  type CacheStore, type RankSnapshot,
} from './index.js';

const NOW = Date.parse('2026-10-09T15:00:00Z');

function memoryStore(): CacheStore & { data: Map<string, { value: unknown; ttlMs: number }> } {
  const data = new Map<string, { value: unknown; ttlMs: number }>();
  return {
    data,
    async get(key) { return data.get(key)?.value ?? null; },
    async set(key, value, ttlMs) { data.set(key, { value, ttlMs }); },
  };
}

function respond(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

const ok = (result: unknown, cost = 0.02) => ({ status_code: 20000, cost, tasks: [{ status_code: 20000, result: [result] }] });

describe('client', () => {
  it('pays once, then serves the cached entry for free', async () => {
    let calls = 0;
    const cache = memoryStore();
    const client = createDataForSeoClient({
      login: 'a', password: 'b', cache, now: () => NOW,
      fetchFn: (async () => { calls++; return new Response(JSON.stringify(ok({ items: [] }))); }) as unknown as typeof fetch,
    });
    const first = await client.live('/x/live', { target: 'example.com' });
    const second = await client.live('/x/live', { target: 'example.com' });
    expect(calls).toBe(1);
    expect(first).toMatchObject({ cost: 0.02, cached: false });
    expect(second).toMatchObject({ cost: 0, cached: true, fetched_at: first.fetched_at });
    expect([...cache.data.keys()]).toEqual([cacheKey('/x/live', [{ target: 'example.com' }])]);
  });

  it('treats a failing cache as a miss', async () => {
    const errors: string[] = [];
    const client = createDataForSeoClient({
      login: 'a', password: 'b',
      cache: { get: async () => { throw new Error('down'); }, set: async () => { throw new Error('down'); } },
      onCacheError: (op) => errors.push(op),
      fetchFn: respond(ok({})),
    });
    await expect(client.live('/x/live', {})).resolves.toMatchObject({ cached: false });
    expect(errors).toEqual(['get', 'set']);
  });

  it('throws DailyLimitError on 40203 with a plain message', async () => {
    const client = createDataForSeoClient({
      login: 'a', password: 'b',
      fetchFn: respond({ status_code: 20000, tasks: [{ status_code: 40203, status_message: 'money limit per day has been exceeded: 3.01 >= 3' }] }),
    });
    const err = await client.live('/x/live', {}).catch((e) => e);
    expect(err).toBeInstanceOf(DailyLimitError);
    expect(err.status).toBe(40203);
    expect(err.message).toBe("DataForSEO's daily spend limit ($3) is used up. It resets at midnight UTC.");
  });
});

describe('client requests', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dfs-client-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  function recording(body: () => unknown) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(body())); }) as unknown as typeof fetch;
    return { calls, fetchFn };
  }

  it('sends Basic auth and GETs user_data uncached', async () => {
    const { calls, fetchFn } = recording(() => ok({ money: { balance: 50 } }, 0));
    const client = createDataForSeoClient({ login: 'me@example.com', password: 'pw', cacheDir: dir, fetchFn });

    await client.userData();
    await client.userData();

    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe('https://api.dataforseo.com/v3/appendix/user_data');
    expect(calls[0]!.init?.method).toBe('GET');
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('me@example.com:pw').toString('base64')}`);
  });

  it('errors without credentials and makes no request', async () => {
    const { calls, fetchFn } = recording(() => ok({}));
    const client = createDataForSeoClient({ login: '', password: '', cacheDir: dir, fetchFn });

    await expect(client.live('/x/live', {})).rejects.toThrow(/DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/);
    expect(calls).toHaveLength(0);
  });

  it('keys the cache by endpoint and body; refresh pays again', async () => {
    const { calls, fetchFn } = recording(() => ok({ items: [] }, 0.0276));
    const client = createDataForSeoClient({ login: 'a', password: 'b', cacheDir: dir, fetchFn });

    await client.live('/x/live', { target: 'a.example' });
    const hit = await client.live('/x/live', { target: 'a.example' });
    const other = await client.live('/x/live', { target: 'b.example' });
    const refreshed = await client.live('/x/live', { target: 'a.example' }, { refresh: true });

    expect(hit.cached).toBe(true);
    expect(other.cached).toBe(false);
    expect(refreshed).toMatchObject({ cost: 0.0276, cached: false });
    expect(calls).toHaveLength(3);
    expect(JSON.parse(String(calls[0]!.init?.body))).toStrictEqual([{ target: 'a.example' }]);
  });

  it('treats an entry past the TTL as a miss', async () => {
    let t = Date.parse('2026-10-01T00:00:00Z');
    const { calls, fetchFn } = recording(() => ok({}));
    const client = createDataForSeoClient({ login: 'a', password: 'b', cacheDir: dir, fetchFn, now: () => t, ttlMs: 1000 });

    await client.live('/x/live', {});
    t += 999;
    expect((await client.live('/x/live', {})).cached).toBe(true);
    t += 2;
    expect((await client.live('/x/live', {})).cached).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('treats a cache returning junk as a miss', async () => {
    const { calls, fetchFn } = recording(() => ok({ ok: true }));
    const client = createDataForSeoClient({ login: 'a', password: 'b', cache: { get: async () => 'not an entry', set: async () => {} }, fetchFn });

    expect(await client.live('/x/live', {})).toMatchObject({ cached: false, result: { ok: true } });
    expect(calls).toHaveLength(1);
  });

  it('throws DataForSeoError on a task error and caches nothing', async () => {
    const { calls, fetchFn } = recording(() => ({ status_code: 20000, cost: 0, tasks: [{ status_code: 40501, status_message: 'Invalid Field: target.' }] }));
    const client = createDataForSeoClient({ login: 'a', password: 'b', cacheDir: dir, fetchFn });

    const err = await client.live('/x/live', { target: '' }).catch((e) => e);
    expect(err).toBeInstanceOf(DataForSeoError);
    expect(err).toMatchObject({ status: 40501, endpoint: '/x/live', message: 'DataForSEO /x/live task 40501: Invalid Field: target.' });
    await expect(client.live('/x/live', { target: '' })).rejects.toThrow(/40501/);
    expect(calls).toHaveLength(2);
  });

  it('reads the daily limit from either level, with or without an amount', async () => {
    const limited = (msg: string, task: boolean) => createDataForSeoClient({
      login: 'a', password: 'b',
      fetchFn: respond(task
        ? { status_code: 20000, cost: 0, tasks: [{ status_code: 40203, status_message: msg }] }
        : { status_code: 40203, status_message: msg, cost: 0, tasks: [] }),
    }).live('/x/live', {});

    await expect(limited('money limit per day has been exceeded: 1.09792 >= 1', false)).rejects.toThrow("DataForSEO's daily spend limit ($1) is used up.");
    await expect(limited('money limit per day has been exceeded: 2.6 >= 2.5', true)).rejects.toThrow("DataForSEO's daily spend limit ($2.50) is used up.");
    await expect(limited('The cost limit has been exceeded.', false)).rejects.toThrow("DataForSEO's daily spend limit is used up. It resets at midnight UTC.");
    await expect(limited('x', false)).rejects.toBeInstanceOf(DataForSeoError);
  });
});

describe('createDiskCacheStore', () => {
  it('expires entries and rejects keys that aren\'t digests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dfs-disk-'));
    let t = 0;
    const store = createDiskCacheStore(dir, () => t);
    const key = 'a'.repeat(64);

    await store.set(key, { v: 1 }, 100);
    expect(await store.get(key)).toStrictEqual({ v: 1 });
    t = 100;
    expect(await store.get(key)).toBeNull();
    expect(await store.get('b'.repeat(64))).toBeNull();
    await expect(store.set('../escape', {}, 100)).rejects.toThrow(/Invalid cache key/);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('dailyBudget', () => {
  it('reads today\'s spend and the account limit', async () => {
    const client = createDataForSeoClient({
      login: 'a', password: 'b',
      fetchFn: respond(ok({ money: { statistics: { day: { value: '2026-10-09', total: 1.25 } }, limits: { day: { total: 3 } } } }, 0)),
    });
    expect(await dailyBudget(client, () => NOW)).toEqual({ date: '2026-10-09', spent: 1.25, limit: 3, left: 1.75 });
  });

  it('counts yesterday\'s statistics as nothing spent today', async () => {
    const client = createDataForSeoClient({
      login: 'a', password: 'b',
      fetchFn: respond(ok({ money: { statistics: { day: { value: '2026-10-08', total: 2.9 } }, limits: { day: { total: 0 } } } }, 0)),
    });
    expect(await dailyBudget(client, () => NOW)).toEqual({ date: '2026-10-09', spent: 0, limit: null, left: null });
  });
});

describe('nextUtcMidnight', () => {
  it('rolls to the next UTC day', () => {
    expect(nextUtcMidnight(NOW).toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });
});

describe('diffSnapshots', () => {
  const snap = (keywords: [string, number][]): RankSnapshot => ({
    id: 'x', domain: 'example.com', location: 'United States', language: 'English', created: '', fetched_at: '',
    total_keywords: keywords.length, etv: 0,
    keywords: keywords.map(([keyword, position]) => ({ keyword, position, search_volume: 10, etv: 1, url: '/' })),
  });

  it('sorts terms into gained, lost, improved and declined', () => {
    const d = diffSnapshots(snap([['a', 5], ['b', 3], ['c', 9]]), snap([['a', 2], ['b', 3], ['d', 7]]));
    expect(d.improved.map((m) => m.keyword)).toEqual(['a']);
    expect(d.gained.map((m) => m.keyword)).toEqual(['d']);
    expect(d.lost.map((m) => m.keyword)).toEqual(['c']);
    expect(d.unchanged).toBe(1);
  });
});
