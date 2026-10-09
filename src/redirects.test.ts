import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  backlinkRedirects, createDataForSeoClient, firstLocation, isGated, mapToOrigin, normalizeDomain, sortWorstFirst,
  stripTracking, verdictFor, type BacklinkRedirectsInput, type PathCheck,
} from './index.js';
import { apiResponse } from './test/api.js';

const NEW = 'https://new.example';

interface Call { url: string; init?: RequestInit }

/** One fetch for both the DataForSEO API and the site under check; `site` answers the path checks. */
function world(pages: { url: string; referring_domains: number }[], site: (url: string) => Response | Promise<Response>, total?: number) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return url.startsWith('https://api.dataforseo.com') ? apiResponse({ total_count: total, items: pages }, 0.0276) : site(url);
  }) as typeof fetch;
  return { fetchFn, calls, pathCalls: () => calls.filter((c) => c.url.startsWith(NEW)) };
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dfs-redirects-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function run(w: ReturnType<typeof world>, input: Partial<BacklinkRedirectsInput> = {}) {
  const client = createDataForSeoClient({ login: 'l', password: 'p', cacheDir: dir, fetchFn: w.fetchFn });
  return backlinkRedirects(client, { domain: 'old.example', new_origin: NEW, fetchFn: w.fetchFn, ...input });
}

const status = (s: number, location?: string) => new Response(null, { status: s, ...(location ? { headers: { location } } : {}) });

describe('backlinkRedirects', () => {
  const PAGES = [
    { url: 'https://www.old.example/', referring_domains: 300 },
    { url: 'https://www.old.example/about', referring_domains: 40 },
    { url: 'https://www.old.example/blog/post?id=7', referring_domains: 25 },
    { url: 'https://www.old.example/gone', referring_domains: 3 },
    { url: 'https://www.old.example/missing', referring_domains: 12 },
    { url: 'https://www.old.example/broken', referring_domains: 8 },
    { url: 'https://www.old.example/down', referring_domains: 5 },
  ];
  const site = (url: string): Response => {
    const u = new URL(url);
    switch (u.pathname + u.search) {
      case '/': return status(200);
      case '/about': return status(301, '/company/about');
      case '/company/about': return status(200);
      case '/blog/post?id=7': return status(301, `${NEW}/`);
      case '/gone': case '/missing': return status(404);
      case '/broken': return status(500);
      default: throw new TypeError('fetch failed');
    }
  };

  it('asks Backlinks for the domain\'s pages by referring domains', async () => {
    const w = world(PAGES, site, 7);

    await run(w, { domain: 'https://www.Old.example/', limit: 50 });

    expect(w.calls[0]!.url).toBe('https://api.dataforseo.com/v3/backlinks/domain_pages_summary/live');
    expect(JSON.parse(String(w.calls[0]!.init?.body))[0]).toMatchObject({ target: 'old.example', limit: 50, order_by: ['referring_domains,desc'] });
  });

  it('checks each path on the new origin, assigns verdicts and sorts worst first', async () => {
    const result = await run(world(PAGES, site, 7));
    const byOld = Object.fromEntries(result.pages.map((p) => [p.old_urls[0], p]));

    expect(byOld['https://www.old.example/']!.verdict).toBe('ok');
    expect(byOld['https://www.old.example/about']).toMatchObject({ verdict: 'redirect-ok', final_url: `${NEW}/company/about`, final_status: 200 });
    expect(byOld['https://www.old.example/about']!.home_redirect).toBeUndefined();
    expect(byOld['https://www.old.example/blog/post?id=7']).toMatchObject({ verdict: 'redirect-ok', home_redirect: true });
    expect(byOld['https://www.old.example/broken']).toMatchObject({ verdict: 'other', final_status: 500 });
    expect(byOld['https://www.old.example/down']).toMatchObject({ verdict: 'other', final_status: null, error: 'fetch failed' });
    expect(result.summary).toStrictEqual({ '404': 2, other: 2, gated: 0, 'redirect-ok': 2, ok: 1 });
    expect(result).toMatchObject({ cost: 0.0276, cached: false, total_pages_with_backlinks: 7, old_urls: 7, checked: 7 });
    expect(result.pages.map((p) => new URL(p.checked_url).pathname)).toStrictEqual(['/missing', '/gone', '/broken', '/down', '/about', '/blog/post', '/']);
  });

  it('a rerun is free and still rechecks the paths', async () => {
    const w = world(PAGES, site, 7);

    await run(w);
    const second = await run(w);

    expect(second).toMatchObject({ cost: 0, cached: true });
    expect(w.calls.filter((c) => c.url.startsWith('https://api.dataforseo.com'))).toHaveLength(1);
    // Seven paths per run, two of which redirect once and one of which drops and is retried.
    expect(w.pathCalls()).toHaveLength(20);
  });

  it('follows each hop, reads the first of duplicated Location values and sends headers to the origin only', async () => {
    const w = world([{ url: 'https://old.example/rebate/', referring_domains: 9 }], (url) => {
      const path = new URL(url).pathname;
      if (path === '/rebate/') return status(308, '/rebate');
      if (path === '/rebate') return status(308, '/services/rebate, /services/rebate');
      if (path === '/services/rebate') return status(200);
      return status(404);
    });

    const result = await run(w, { headers: { Cookie: 'session=SECRET' } });

    expect(result.pages[0]).toMatchObject({
      verdict: 'redirect-ok', final_status: 200, final_url: `${NEW}/services/rebate`,
      hops: [{ url: `${NEW}/rebate/`, status: 308 }, { url: `${NEW}/rebate`, status: 308 }],
    });
    expect(w.pathCalls().every((c) => (c.init?.headers as Record<string, string>).Cookie === 'session=SECRET')).toBe(true);
    expect(w.pathCalls().every((c) => c.init?.redirect === 'manual')).toBe(true);
    expect(JSON.stringify(w.calls[0]!.init)).not.toMatch(/SECRET/);
    expect(JSON.stringify(result)).not.toMatch(/SECRET/);
  });

  it('stops after ten redirects', async () => {
    const result = await run(world([{ url: 'https://old.example/loop', referring_domains: 1 }], () => status(302, '/loop')));

    expect(result.pages[0]).toMatchObject({ verdict: 'other', error: 'More than 10 redirects' });
    expect(result.pages[0]!.hops).toHaveLength(10);
  });

  it('retries a dropped connection once, but not a timeout or an HTTP error', async () => {
    const tries = new Map<string, number>();
    const w = world(['blip', 'down', 'slow', 'gone'].map((p) => ({ url: `https://old.example/${p}`, referring_domains: 1 })), (url) => {
      const path = new URL(url).pathname;
      tries.set(path, (tries.get(path) ?? 0) + 1);
      if (path === '/blip' && tries.get(path) === 1) throw new TypeError('fetch failed');
      if (path === '/down') throw new TypeError('fetch failed');
      if (path === '/slow') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      return status(path === '/gone' ? 404 : 200);
    });

    const result = await run(w);
    const byPath = Object.fromEntries(result.pages.map((p) => [new URL(p.checked_url).pathname, p]));

    expect(byPath['/blip']).toMatchObject({ verdict: 'ok', final_status: 200 });
    expect(byPath['/down']).toMatchObject({ verdict: 'other', error: 'fetch failed' });
    expect(byPath['/down']).not.toHaveProperty('retry');
    expect(Object.fromEntries(tries)).toStrictEqual({ '/blip': 2, '/down': 2, '/slow': 1, '/gone': 1 });
  });

  it('checks each path once, merging scheme, www and tracking-param variants', async () => {
    const w = world([
      { url: 'https://old.example/', referring_domains: 50 },
      { url: 'http://www.old.example/', referring_domains: 7 },
      { url: 'https://old.example/contact', referring_domains: 10 },
      { url: 'https://old.example/contact?gclid=abc&utm_source=x', referring_domains: 2 },
      { url: 'https://old.example/search?q=pipes&fbclid=z', referring_domains: 1 },
    ], () => status(200));

    const result = await run(w);

    expect(w.pathCalls().map((c) => c.url)).toStrictEqual([`${NEW}/`, `${NEW}/contact`, `${NEW}/search?q=pipes`]);
    expect(result).toMatchObject({ old_urls: 5, checked: 3 });
    expect(result.pages.find((p) => p.checked_url === `${NEW}/`)).toMatchObject({ referring_domains: 57, old_urls: ['https://old.example/', 'http://www.old.example/'] });
    expect(result.pages.find((p) => p.checked_url === `${NEW}/contact`)).toMatchObject({ referring_domains: 12 });
  });

  it('scores a login wall as gated and sorts it with the problems', async () => {
    const w = world([
      { url: 'https://old.example/account', referring_domains: 30 },
      { url: 'https://old.example/about', referring_domains: 20 },
      { url: 'https://old.example/missing', referring_domains: 1 },
    ], (url) => {
      const path = new URL(url).pathname;
      if (path === '/missing') return status(404);
      if (path === '/about') return status(301, '/company');
      if (path === '/account') return status(302, `/admin/login?redirect=${encodeURIComponent(path)}`);
      return status(200);
    });

    const result = await run(w);

    expect(result.pages.map((p) => p.verdict)).toStrictEqual(['404', 'gated', 'redirect-ok']);
  });

  it('caps concurrent path checks at 5', async () => {
    let inFlight = 0;
    let peak = 0;
    const w = world(Array.from({ length: 20 }, (_, i) => ({ url: `https://old.example/p${i}`, referring_domains: i })), async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return status(200);
    });

    const result = await run(w);

    expect(result.checked).toBe(20);
    expect(peak).toBe(5);
  });
});

describe('redirect helpers', () => {
  it('normalizeDomain strips scheme, www and path', () => {
    expect(normalizeDomain('https://www.Example.com/a?b')).toBe('example.com');
    expect(normalizeDomain('blog.example.com')).toBe('blog.example.com');
  });

  it('stripTracking keeps non-tracking params as written', () => {
    expect(stripTracking('?utm_source=a&UTM_Medium=b&gclid=c&msclkid=d')).toBe('');
    expect(stripTracking('?page=2&utm_campaign=x&sort=new%20est')).toBe('?page=2&sort=new%20est');
    expect(mapToOrigin('http://www.old.example/a?id=7&fbclid=x', NEW)).toBe(`${NEW}/a?id=7`);
  });

  it('firstLocation', () => {
    expect(firstLocation('/a, /a')).toBe('/a');
    expect(firstLocation('https://x.example/a, https://x.example/a')).toBe('https://x.example/a');
    expect(firstLocation('/search?q=a, b')).toBe('/search?q=a, b');
    expect(firstLocation(null)).toBeNull();
  });

  it('isGated', () => {
    const c = `${NEW}/account`;
    expect(isGated(c, `${NEW}/admin/login?redirect=%2Faccount`, 200)).toBe(true);
    expect(isGated(c, `${NEW}/wp-login.php`, 200)).toBe(true);
    expect(isGated(c, `${NEW}/gate?next=${encodeURIComponent(c)}`, 200)).toBe(true);
    expect(isGated(c, c, 401)).toBe(true);
    expect(isGated(c, `${NEW}/accounts/overview`, 200)).toBe(false);
    expect(isGated(c, `${NEW}/search?next=%2Fother`, 200)).toBe(false);
    expect(isGated(`${NEW}/login`, `${NEW}/login`, 200)).toBe(false);
  });

  it('verdictFor', () => {
    expect(verdictFor(200, false)).toBe('ok');
    expect(verdictFor(204, true)).toBe('redirect-ok');
    expect(verdictFor(404, true)).toBe('404');
    expect(verdictFor(410, false)).toBe('other');
  });

  it('sortWorstFirst leaves its input alone', () => {
    const input = [{ verdict: 'ok', referring_domains: 1 }, { verdict: '404', referring_domains: 1 }] as PathCheck[];
    expect(sortWorstFirst(input).map((p) => p.verdict)).toStrictEqual(['404', 'ok']);
    expect(input[0]!.verdict).toBe('ok');
  });
});
