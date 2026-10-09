import { createHash } from 'node:crypto';
import { createDiskCacheStore, type CacheStore } from './cache.js';

const BASE_URL = 'https://api.dataforseo.com/v3';

/** How long paid responses stay cached: 7 days. */
export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Per-request timeout: 30 seconds. */
export const DEFAULT_TIMEOUT_MS = 30_000;

const OK = 20000;
/** DataForSEO's status code for a used-up daily spend limit. */
export const DAILY_LIMIT_STATUS = 40203;

/** 40203 as a plain message, e.g. "money limit per day has been exceeded: 1.09792 >= 1". */
export function costLimitMessage(statusMessage: unknown): string {
  const limit = Number(String(statusMessage ?? '').match(/>=\s*([\d.]+)/)?.[1]);
  const amount = Number.isFinite(limit) ? ` ($${Number.isInteger(limit) ? limit : limit.toFixed(2)})` : '';
  return `DataForSEO's daily spend limit${amount} is used up. It resets at midnight UTC.`;
}

/** The next midnight UTC, when the daily spend limit resets. */
export function nextUtcMidnight(at: number = Date.now()): Date {
  const d = new Date(at);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}

/** A DataForSEO error response. `status` is DataForSEO's status code, or the HTTP status when the body isn't JSON. */
export class DataForSeoError extends Error {
  constructor(message: string, readonly status: number | null, readonly endpoint: string) {
    super(message);
    this.name = 'DataForSeoError';
  }
}

/** Status 40203: the account's daily spend limit is used up. */
export class DailyLimitError extends DataForSeoError {
  declare readonly status: typeof DAILY_LIMIT_STATUS;
  constructor(statusMessage: unknown, endpoint = '') {
    super(costLimitMessage(statusMessage), DAILY_LIMIT_STATUS, endpoint);
    this.name = 'DailyLimitError';
  }
}

/** One DataForSEO call. `cost` is USD for this call: 0 when served from cache. */
export interface Charged<T = any> {
  result: T;
  cost: number;
  cached: boolean;
  fetched_at: string;
}

/** The client the checks take. */
export interface DataForSeoClient {
  /** Account money and limits. The endpoint is free, so it is never cached. */
  userData(): Promise<Charged>;
  /** POSTs one task to a live endpoint, through the cache. */
  live(endpoint: string, task: Record<string, unknown>, opts?: { refresh?: boolean; timeoutMs?: number }): Promise<Charged>;
}

/** Options for `createDataForSeoClient`. */
export interface DataForSeoOptions {
  /** API login from the DataForSEO dashboard. */
  login: string;
  /** API password, not the account password. */
  password: string;
  /** Where paid responses are cached. Takes precedence over `cacheDir`. */
  cache?: CacheStore;
  /** Shorthand for a disk cache in this directory. */
  cacheDir?: string;
  /** Default: `DEFAULT_TTL_MS`. */
  ttlMs?: number;
  /** Default: `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Where cache failures are reported. Default: `console.error`. */
  onCacheError?: (op: 'get' | 'set', err: unknown) => void;
}

interface CacheEntry {
  endpoint: string;
  body: unknown;
  fetched_at: string;
  cost: number;
  result: unknown;
}

function isEntry(v: unknown): v is CacheEntry {
  return !!v && typeof v === 'object' && typeof (v as CacheEntry).fetched_at === 'string' && 'result' in v;
}

/** SHA-256 hex digest of the endpoint and request body. */
export function cacheKey(endpoint: string, body: unknown): string {
  return createHash('sha256').update(`${endpoint}\n${JSON.stringify(body)}`).digest('hex');
}

/** A DataForSEO client that caches paid responses. */
export function createDataForSeoClient(opts: DataForSeoOptions): DataForSeoClient {
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const cache = opts.cache ?? (opts.cacheDir ? createDiskCacheStore(opts.cacheDir, now) : undefined);
  const onCacheError = opts.onCacheError
    ?? ((op, err) => console.error(`dataforseo cache ${op} failed: ${err instanceof Error ? err.message : String(err)}`));

  function requireCredentials(): string {
    if (!opts.login || !opts.password) {
      throw new Error('DataForSEO is not configured: set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD.');
    }
    return `Basic ${Buffer.from(`${opts.login}:${opts.password}`).toString('base64')}`;
  }

  async function request(endpoint: string, body?: unknown, timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS): Promise<{ result: unknown; cost: number }> {
    const auth = requireCredentials();
    const res = await fetchFn(`${BASE_URL}${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new DataForSeoError(`DataForSEO ${endpoint} ${res.status}: ${text.slice(0, 300)}`, res.status, endpoint);
    }
    if (data?.status_code === DAILY_LIMIT_STATUS) throw new DailyLimitError(data.status_message, endpoint);
    if (!res.ok || data?.status_code !== OK) {
      const status = data?.status_code ?? res.status;
      throw new DataForSeoError(`DataForSEO ${endpoint} ${status}: ${data?.status_message ?? text.slice(0, 300)}`, status, endpoint);
    }
    const task = data.tasks?.[0];
    if (task?.status_code === DAILY_LIMIT_STATUS) throw new DailyLimitError(task.status_message, endpoint);
    if (!task || task.status_code !== OK) {
      const message = `DataForSEO ${endpoint} task ${task?.status_code ?? 'missing'}: ${task?.status_message ?? 'no task in response'}`;
      throw new DataForSeoError(message, task?.status_code ?? null, endpoint);
    }
    return { result: task.result?.[0] ?? null, cost: Number(data.cost ?? 0) };
  }

  async function readCache(key: string): Promise<CacheEntry | null> {
    if (!cache) return null;
    try {
      const hit = await cache.get(key);
      return isEntry(hit) ? hit : null;
    } catch (err) {
      onCacheError('get', err);
      return null;
    }
  }

  async function writeCache(key: string, entry: CacheEntry): Promise<void> {
    if (!cache) return;
    try {
      await cache.set(key, entry, ttlMs);
    } catch (err) {
      onCacheError('set', err);
    }
  }

  return {
    async userData() {
      const { result, cost } = await request('/appendix/user_data');
      return { result, cost, cached: false, fetched_at: new Date(now()).toISOString() };
    },

    async live(endpoint, task, { refresh = false, timeoutMs } = {}) {
      requireCredentials();
      const body = [task];
      const key = cacheKey(endpoint, body);
      if (!refresh) {
        const hit = await readCache(key);
        if (hit) return { result: hit.result as any, cost: 0, cached: true, fetched_at: hit.fetched_at };
      }
      const { result, cost } = await request(endpoint, body, timeoutMs);
      const entry: CacheEntry = { endpoint, body, fetched_at: new Date(now()).toISOString(), cost, result };
      await writeCache(key, entry);
      return { result, cost, cached: false, fetched_at: entry.fetched_at };
    },
  };
}
