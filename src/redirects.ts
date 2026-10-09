import { DEFAULT_TIMEOUT_MS, type DataForSeoClient } from './client.js';
import { mapLimit, normalizeDomain } from './util.js';

export const DEFAULT_REDIRECT_LIMIT = 100;

const PATH_CHECK_CONCURRENCY = 5;

export type RedirectVerdict = 'ok' | 'redirect-ok' | '404' | 'gated' | 'other';

const SEVERITY: Record<RedirectVerdict, number> = { '404': 0, other: 1, gated: 1, 'redirect-ok': 2, ok: 3 };

/** Old URLs that land on the same path on the new origin. `referring_domains` is their sum. */
export interface PathTarget {
  checked_url: string;
  old_urls: string[];
  referring_domains: number;
}

export interface PathCheck extends PathTarget {
  final_status: number | null;
  final_url: string | null;
  verdict: RedirectVerdict;
  /** Redirected to the new site's homepage from a deeper path, which search engines treat as a soft 404. */
  home_redirect?: true;
  /** Each redirect followed, in order. */
  hops?: { url: string; status: number }[];
  error?: string;
}

export function verdictFor(status: number, redirected: boolean): RedirectVerdict {
  if (status === 404) return '404';
  if (status >= 200 && status < 300) return redirected ? 'redirect-ok' : 'ok';
  return 'other';
}

const LOGIN_SEGMENT = /^(login|log-in|signin|sign-in|sign_in|wp-login\.php|auth|oauth|sso|authenticate)$/i;

const RETURN_PARAMS = ['redirect', 'redirect_to', 'redirect_uri', 'redirecturl', 'next', 'return', 'returnto', 'return_to', 'returnurl', 'continue', 'callbackurl', 'from'];

/** A 401, or a redirect that lands on a login page or carries the requested path back as a return param. */
export function isGated(checkedUrl: string, finalUrl: string, status: number): boolean {
  if (status === 401) return true;
  if (finalUrl === checkedUrl) return false;
  const checked = new URL(checkedUrl);
  const final = new URL(finalUrl);
  if (final.pathname.split('/').some((seg) => LOGIN_SEGMENT.test(seg))) return true;
  for (const [name, value] of final.searchParams) {
    if (!RETURN_PARAMS.includes(name.toLowerCase()) || !value) continue;
    try {
      const back = new URL(value, checked);
      if (back.pathname === checked.pathname) return true;
    } catch { /* not a URL */ }
  }
  return false;
}

const TRACKING_PARAMS = new Set([
  'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'igshid',
  'li_fat_id', 'mc_cid', 'mc_eid', '_ga', '_gl', '_hsenc', '_hsmi', 'mkt_tok', 'bblinkid', 'bbemailid', 'bbejrid',
]);

function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase();
  return key.startsWith('utm_') || TRACKING_PARAMS.has(key);
}

/** Drops utm_* and click-ID params, leaving the rest of the query as written. */
export function stripTracking(search: string): string {
  const kept = search.replace(/^\?/, '').split('&')
    .filter((pair) => pair && !isTrackingParam(pair.split('=')[0]));
  return kept.length ? `?${kept.join('&')}` : '';
}

/** Same path and query on `origin`, without tracking params. */
export function mapToOrigin(oldUrl: string, origin: string): string {
  const old = new URL(oldUrl);
  return new URL(`${old.pathname}${stripTracking(old.search)}`, origin).toString();
}

/** One target per checked URL, in first-seen order. */
export function groupByPath(pages: { url: string; referring_domains: number }[], origin: string): PathTarget[] {
  const byPath = new Map<string, PathTarget>();
  for (const p of pages) {
    const checked = mapToOrigin(p.url, origin);
    const target = byPath.get(checked);
    if (target) {
      target.old_urls.push(p.url);
      target.referring_domains += p.referring_domains;
    } else {
      byPath.set(checked, { checked_url: checked, old_urls: [p.url], referring_domains: p.referring_domains });
    }
  }
  return [...byPath.values()];
}

/** Worst verdict first, then most referring domains. */
export function sortWorstFirst(checks: PathCheck[]): PathCheck[] {
  return [...checks].sort((a, b) => SEVERITY[a.verdict] - SEVERITY[b.verdict] || b.referring_domains - a.referring_domains);
}

const RETRY_DELAY_MS = 500;
const MAX_HOPS = 10;

/** The first value of a Location header, since some proxies join duplicates with ", ". */
export function firstLocation(header: string | null): string | null {
  if (!header) return null;
  return header.split(/,\s+(?=\/|https?:\/\/)/)[0].trim() || null;
}

/** A dropped connection: fetch throws a TypeError. Timeouts and redirect loops aren't retried. */
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

async function checkPath(target: PathTarget, headers: Record<string, string>, fetchFn: typeof fetch): Promise<PathCheck & { retry?: true }> {
  const checked = target.checked_url;
  const base = { ...target };
  const origin = new URL(checked).origin;
  const hops: { url: string; status: number }[] = [];
  try {
    let url = checked;
    let res: Response;
    for (;;) {
      res = await fetchFn(url, {
        redirect: 'manual',
        headers: new URL(url).origin === origin ? headers : {},
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      await res.body?.cancel().catch(() => {});
      const location = res.status >= 300 && res.status < 400 ? firstLocation(res.headers.get('location')) : null;
      if (!location) break;
      if (hops.length >= MAX_HOPS) throw new Error(`More than ${MAX_HOPS} redirects`);
      hops.push({ url, status: res.status });
      url = new URL(location, url).toString();
    }
    const finalUrl = url;
    const redirected = hops.length > 0;
    const withHops = redirected ? { ...base, hops } : base;
    if (isGated(checked, finalUrl, res.status)) return { ...withHops, final_status: res.status, final_url: finalUrl, verdict: 'gated' };
    const check: PathCheck = { ...withHops, final_status: res.status, final_url: finalUrl, verdict: verdictFor(res.status, redirected) };
    if (redirected && new URL(checked).pathname !== '/' && new URL(finalUrl).pathname === '/') check.home_redirect = true;
    return check;
  } catch (err) {
    return {
      ...base, ...(hops.length ? { hops } : {}), final_status: null, final_url: null, verdict: 'other',
      error: err instanceof Error ? err.message : String(err), ...(isNetworkError(err) ? { retry: true as const } : {}),
    };
  }
}

/** A dropped connection gets one more try, so a network blip isn't reported as a broken page. */
async function checkPathWithRetry(target: PathTarget, headers: Record<string, string>, fetchFn: typeof fetch): Promise<PathCheck> {
  const { retry, ...first } = await checkPath(target, headers, fetchFn);
  if (!retry) return first;
  await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  const { retry: _again, ...second } = await checkPath(target, headers, fetchFn);
  return second;
}

export interface BacklinkRedirectsInput {
  domain: string;
  new_origin: string;
  limit?: number;
  refresh?: boolean;
  /** Sent on the path checks only. */
  headers?: Record<string, string>;
  fetchFn?: typeof fetch;
  onProgress?: (message: string) => Promise<void> | void;
}

export interface BacklinkRedirectsResult {
  domain: string;
  new_origin: string;
  total_pages_with_backlinks?: number;
  old_urls: number;
  checked: number;
  summary: Record<RedirectVerdict, number>;
  pages: PathCheck[];
  cost: number;
  cached: boolean;
  fetched_at: string;
}

/** Old domain's linked pages from Backlinks, each distinct path requested on new_origin. */
export async function backlinkRedirects(client: DataForSeoClient, input: BacklinkRedirectsInput): Promise<BacklinkRedirectsResult> {
  const target = normalizeDomain(input.domain);
  const res = await client.live('/backlinks/domain_pages_summary/live', {
    target,
    limit: input.limit ?? DEFAULT_REDIRECT_LIMIT,
    order_by: ['referring_domains,desc'],
    internal_list_limit: 1,
  }, { refresh: input.refresh });

  const items: any[] = Array.isArray(res.result?.items) ? res.result.items : [];
  const pages = items.filter((i) => typeof i?.url === 'string' && /^https?:\/\//.test(i.url));
  const targets = groupByPath(pages.map((p) => ({ url: p.url, referring_domains: Number(p.referring_domains ?? 0) })), input.new_origin);
  await input.onProgress?.(`Checking ${targets.length} paths on ${input.new_origin}`);
  const checks = await mapLimit(targets, PATH_CHECK_CONCURRENCY, (t) => checkPathWithRetry(t, input.headers ?? {}, input.fetchFn ?? fetch));

  const summary: Record<RedirectVerdict, number> = { '404': 0, other: 0, gated: 0, 'redirect-ok': 0, ok: 0 };
  for (const c of checks) summary[c.verdict]++;
  return {
    domain: target,
    new_origin: input.new_origin,
    total_pages_with_backlinks: res.result?.total_count,
    old_urls: pages.length,
    checked: checks.length,
    summary,
    pages: sortWorstFirst(checks),
    cost: res.cost,
    cached: res.cached,
    fetched_at: res.fetched_at,
  };
}
