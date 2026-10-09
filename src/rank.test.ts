import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDataForSeoClient, DailyLimitError, estimateRankCost, QueueTimeoutError, rankCheck, rankDiff,
  type RankCheckInput, type RankCheckResult, type RankTerm,
} from './index.js';
import { API } from './test/api.js';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const SERP = '/serp/google/organic';

const organic = (rank: number, domain: string, path = '/') =>
  ({ type: 'organic', rank_group: rank, domain, url: `https://${domain}${path}`, title: `${domain} page` });

/** Search results per term: acme.example ranks via www for plumber, via a subdomain for drains, not at all for pipes. */
const SERPS: Record<string, unknown> = {
  plumber: { item_types: ['local_pack', 'organic'], items: [organic(1, 'rival.example'), organic(2, 'www.acme.example', '/plumbing')] },
  'drain cleaning': { item_types: ['organic', 'people_also_ask'], items: [organic(1, 'blog.acme.example', '/drains')] },
  pipes: { item_types: ['organic'], items: [organic(1, 'rival.example'), organic(2, 'notacme.example')] },
};

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dfs-rank-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const envelope = (tasks: unknown[], cost = 0) => new Response(JSON.stringify({ status_code: 20000, cost, tasks }));

/** A fake SERP API. Tasks show in tasks_ready after `readyAfter` polls; `budget` is the daily limit left. */
function fakeSerp({ readyAfter = 1, budget = null as number | null, postStatus = 20100 } = {}) {
  const calls: { path: string; body: any }[] = [];
  const posted = new Map<string, any>();
  let polls = 0;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).replace(API, '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    if (path === '/appendix/user_data') {
      const limits = budget === null ? {} : { day: { total: 1 } };
      const day = { value: '2026-10-09', total: budget === null ? 0 : 1 - budget };
      return envelope([{ status_code: 20000, result: [{ money: { limits, statistics: { day } } }] }]);
    }
    if (path === `${SERP}/task_post`) {
      return envelope(body.map((t: any, i: number) => {
        const id = `task-${posted.size + i}`;
        return { id, status_code: postStatus, status_message: postStatus === 40203 ? 'Daily limit >= 1' : 'Task Created.', cost: 0.0006, data: t, result: null };
      }).map((t: any) => (posted.set(t.id, t.data), t)));
    }
    if (path === `${SERP}/tasks_ready`) {
      polls++;
      const ready = polls > readyAfter ? [...posted.keys()].map((id) => ({ id })) : [];
      return envelope([{ status_code: 20000, result: ready }]);
    }
    if (path.startsWith(`${SERP}/task_get/regular/`)) {
      const task = posted.get(path.split('/').at(-1)!);
      return envelope([{ status_code: 20000, result: [SERPS[task.keyword] ?? { items: [] }] }]);
    }
    if (path === `${SERP}/live/regular`) {
      return envelope([{ status_code: 20000, result: [SERPS[body[0].keyword] ?? { items: [] }] }], 0.002);
    }
    throw new Error(`unexpected ${path}`);
  }) as typeof fetch;
  const client = createDataForSeoClient({ login: 'l', password: 'p', cacheDir: join(dir, 'cache'), fetchFn, now: () => NOW });
  const paths = () => calls.map((c) => c.path.replace(/task-\d+$/, ':id'));
  return { client, calls, paths };
}

const input = (more: Partial<RankCheckInput> = {}): RankCheckInput =>
  ({ domain: 'https://www.acme.example/', keywords: ['Plumber', 'drain cleaning', 'pipes'], pollMs: 0, ...more });

describe('rankCheck', () => {
  it('queues every term in one batch, polls until ready and matches the domain with www and subdomains', async () => {
    const { client, calls, paths } = fakeSerp({ readyAfter: 1 });

    const r = await rankCheck(client, input(), () => NOW);

    expect(paths()).toStrictEqual([
      '/appendix/user_data', `${SERP}/task_post`, `${SERP}/tasks_ready`, `${SERP}/tasks_ready`,
      `${SERP}/task_get/regular/:id`, `${SERP}/task_get/regular/:id`, `${SERP}/task_get/regular/:id`,
    ]);
    expect(calls[1].body[0]).toStrictEqual({ keyword: 'plumber', location_name: 'United States', language_name: 'English', device: 'desktop', depth: 10, tag: '0' });
    expect(r.terms.map((t) => [t.keyword, t.position, t.url])).toStrictEqual([
      ['plumber', 2, 'https://www.acme.example/plumbing'],
      ['drain cleaning', 1, 'https://blog.acme.example/drains'],
      ['pipes', null, null],
    ]);
    expect(r.terms[0]).toMatchObject({ title: 'www.acme.example page', features: ['local_pack'], top_3: [{ position: 1, domain: 'rival.example' }, { position: 2, domain: 'acme.example' }] });
    expect(r).toMatchObject({ domain: 'acme.example', mode: 'queue', cost: 0.0018, cached: false, summary: { top_3: 2, page_one: 2, lower: 0, not_found: 1 } });
  });

  it('posts at most 100 tasks per call and marks priority tasks', async () => {
    const { client, calls } = fakeSerp({ readyAfter: 0 });
    const keywords = Array.from({ length: 150 }, (_, i) => `term ${i}`);

    const r = await rankCheck(client, input({ keywords, max_keywords: 150, mode: 'priority' }), () => NOW);

    const posts = calls.filter((c) => c.path.endsWith('/task_post'));
    expect(posts.map((p) => p.body.length)).toStrictEqual([100, 50]);
    expect(posts[1].body[0]).toMatchObject({ keyword: 'term 100', tag: '100', priority: 2 });
    expect(r.terms).toHaveLength(150);
    expect(r.terms[149].keyword).toBe('term 149');
  });

  it('throws QueueTimeoutError with the task ids when results take too long', async () => {
    const { client } = fakeSerp({ readyAfter: Infinity });

    const err = await rankCheck(client, input({ keywords: ['plumber'], pollMs: 5, timeoutMs: 20 }), () => NOW).catch((e) => e);

    expect(err).toBeInstanceOf(QueueTimeoutError);
    expect(err.ids).toStrictEqual(['task-0']);
  });

  it('caches each term by term, location, language, device and depth, shared across modes', async () => {
    const { client, paths } = fakeSerp();

    await rankCheck(client, input({ keywords: ['plumber'], mode: 'live' }), () => NOW);
    const again = await rankCheck(client, input({ keywords: ['plumber', 'pipes'] }), () => NOW);
    const before = paths().length;
    await rankCheck(client, input({ keywords: ['plumber'], device: 'mobile', mode: 'live' }), () => NOW);
    await rankCheck(client, input({ keywords: ['plumber'], depth: 20, mode: 'live' }), () => NOW);
    await rankCheck(client, input({ keywords: ['plumber'], mode: 'live', refresh: true }), () => NOW);

    expect(again.terms.map((t) => [t.keyword, t.cached, t.cost])).toStrictEqual([['plumber', true, 0], ['pipes', false, 0.0006]]);
    expect(paths().filter((p) => p.endsWith('/task_post'))).toHaveLength(1);
    expect(paths().slice(before).filter((p) => p.endsWith('/live/regular'))).toHaveLength(3);
  });

  it('refuses before paying: too many terms, a bad depth or not enough daily budget', async () => {
    const { client, calls } = fakeSerp({ budget: 0.001 });

    await expect(rankCheck(client, input({ max_keywords: 2 }))).rejects.toThrow('3 search terms is more than max_keywords (2)');
    await expect(rankCheck(client, input({ depth: 5 }))).rejects.toThrow('from 10 to 100');
    const err = await rankCheck(client, input({ mode: 'live' }), () => NOW).catch((e) => e);

    expect(err).toBeInstanceOf(DailyLimitError);
    expect(err.message).toBe("This check could cost up to $0.0060 and $0.0010 of DataForSEO's daily spend limit ($1) is left. It resets at midnight UTC.");
    expect(calls.map((c) => c.path)).toStrictEqual(['/appendix/user_data']);
  });

  it('throws DailyLimitError when DataForSEO refuses the tasks', async () => {
    const { client } = fakeSerp({ postStatus: 40203 });

    await expect(rankCheck(client, input(), () => NOW)).rejects.toBeInstanceOf(DailyLimitError);
  });
});

describe('estimateRankCost', () => {
  it('charges 75% for each page after the first', () => {
    expect(estimateRankCost(100)).toBe(0.06);
    expect(estimateRankCost(1, 'live', 100)).toBe(0.0155);
    expect(estimateRankCost(1, 'priority', 15)).toBe(0.0021);
  });
});

const term = (keyword: string, position: number | null): RankTerm =>
  ({ keyword, position, url: position ? `https://acme.example/${keyword}` : null, title: null, features: [], top_3: [], cost: 0, cached: false, fetched_at: '' });
const check = (terms: RankTerm[], depth = 10): RankCheckResult => ({
  domain: 'acme.example', location: 'United States', language: 'English', device: 'desktop', depth, mode: 'queue', terms,
  summary: { top_3: 0, page_one: 0, lower: 0, not_found: 0 }, cost: 0, cached: false, fetched_at: '2026-10-01T12:00:00.000Z',
});

describe('rankDiff', () => {
  it('sorts each term into gained, lost, improved, declined or unchanged with its change', () => {
    const prev = check([term('a', 5), term('b', 3), term('c', null), term('d', 2), term('e', 4), term('f', null), term('old', 1)], 20);
    const next = check([term('a', 2), term('b', 9), term('c', 7), term('d', null), term('e', 4), term('f', 15), term('new', 1)]);

    const diff = rankDiff(prev, next);

    expect(diff.improved).toStrictEqual([{ keyword: 'a', from: 5, to: 2, change: 3, url: 'https://acme.example/a' }]);
    expect(diff.declined.map((m) => [m.keyword, m.change])).toStrictEqual([['b', -6]]);
    expect(diff.gained.map((m) => [m.keyword, m.to])).toStrictEqual([['c', 7]]);
    expect(diff.lost.map((m) => [m.keyword, m.from, m.url])).toStrictEqual([['d', 2, 'https://acme.example/d']]);
    expect(diff.unchanged.map((m) => m.keyword)).toStrictEqual(['e', 'f']);
    expect(diff).toMatchObject({ depth: 10, not_compared: ['new', 'old'] });
  });

  it('refuses checks from different devices', () => {
    expect(() => rankDiff(check([]), { ...check([]), device: 'mobile' })).toThrow('same location, language and device');
  });
});
