import { describe, it, expect } from 'vitest';
import {
  cacheKey, createDataForSeoClient, dailyBudget, DailyLimitError, diffSnapshots, nextUtcMidnight,
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
