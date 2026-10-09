import { createHash } from 'node:crypto';
import { createDiskCacheStore, type CacheStore } from './cache.js';

const BASE_URL = 'https://api.dataforseo.com/v3';

/** How long paid responses stay cached: 7 days. */
export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Per-request timeout: 30 seconds. */
export const DEFAULT_TIMEOUT_MS = 30_000;

const OK = 20000;
const CREATED = 20100;
/** Most tasks one task_post call takes. */
export const TASK_POST_LIMIT = 100;
/** DataForSEO's status code for a used-up daily spend limit. */
export const DAILY_LIMIT_STATUS = 40203;

/** The daily-limit error as a plain sentence, with the limit when DataForSEO gives one. */
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
  constructor(statusMessage: unknown, endpoint = '', message = costLimitMessage(statusMessage)) {
    super(message, DAILY_LIMIT_STATUS, endpoint);
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

/** Thrown when queued tasks aren't ready in time. They're paid for; `ids` collects them later. */
export class QueueTimeoutError extends Error {
  constructor(readonly ids: string[], timeoutMs: number) {
    super(`${ids.length} queued ${ids.length === 1 ? 'task wasn\'t' : 'tasks weren\'t'} ready after ${Math.round(timeoutMs / 1000)} seconds. DataForSEO keeps results for 30 days: ${ids.join(', ')}.`);
    this.name = 'QueueTimeoutError';
  }
}

/** Options for `DataForSeoClient.queued`. */
export interface QueueOptions {
  /** High priority: faster, at twice the price. */
  priority?: boolean;
  /** Wait between tasks_ready checks. Default: 10 seconds. */
  pollMs?: number;
  /** Throws `QueueTimeoutError` after this long. Default: 10 minutes. */
  timeoutMs?: number;
}

/** The client the checks take. */
export interface DataForSeoClient {
  /** Account balance and limits. Free, so never cached. */
  userData(): Promise<Charged>;
  /** Sends one task to a live endpoint, through the cache. */
  live(endpoint: string, task: Record<string, unknown>, opts?: { refresh?: boolean; timeoutMs?: number }): Promise<Charged>;
  /** The cached response for this live task, or null. Free. */
  cached?(endpoint: string, task: Record<string, unknown>): Promise<Charged | null>;
  /**
   * Posts tasks to `{api}/task_post`, waits for `{api}/tasks_ready` and fetches each from `{api}/task_get/regular`.
   * Results keep input order and are cached as if sent to `{api}/live/regular`. Never reads the cache.
   */
  queued?(api: string, tasks: Record<string, unknown>[], opts?: QueueOptions): Promise<Charged[]>;
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

  async function send(endpoint: string, body?: unknown, timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS): Promise<any> {
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
    return data;
  }

  function checkTask(endpoint: string, task: any, ok = OK): void {
    if (task?.status_code === DAILY_LIMIT_STATUS) throw new DailyLimitError(task.status_message, endpoint);
    if (!task || task.status_code !== ok) {
      const message = `DataForSEO ${endpoint} task ${task?.status_code ?? 'missing'}: ${task?.status_message ?? 'no task in response'}`;
      throw new DataForSeoError(message, task?.status_code ?? null, endpoint);
    }
  }

  async function request(endpoint: string, body?: unknown, timeoutMs?: number): Promise<{ result: unknown; cost: number }> {
    const data = await send(endpoint, body, timeoutMs);
    const task = data.tasks?.[0];
    checkTask(endpoint, task);
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

    async cached(endpoint, task) {
      const hit = await readCache(cacheKey(endpoint, [task]));
      return hit ? { result: hit.result as any, cost: 0, cached: true, fetched_at: hit.fetched_at } : null;
    },

    async queued(api, tasks, { priority = false, pollMs = 10_000, timeoutMs = 600_000 } = {}) {
      requireCredentials();
      const post = `${api}/task_post`;
      const ids: string[] = [];
      const costs: number[] = [];
      for (let start = 0; start < tasks.length; start += TASK_POST_LIMIT) {
        const batch = tasks.slice(start, start + TASK_POST_LIMIT);
        const data = await send(post, batch.map((t, i) => ({ ...t, tag: String(start + i), ...(priority ? { priority: 2 } : {}) })));
        for (const task of data.tasks ?? []) {
          checkTask(post, task, CREATED);
          const i = Number(task.data?.tag);
          ids[i] = task.id;
          costs[i] = Number(task.cost ?? 0);
        }
      }

      const out: Charged[] = new Array(tasks.length);
      const pending = new Map(ids.map((id, i) => [id, i]));
      const deadline = Date.now() + timeoutMs;
      while (pending.size) {
        const ready = await send(`${api}/tasks_ready`);
        for (const item of ready.tasks?.[0]?.result ?? []) {
          const i = pending.get(item?.id);
          if (i === undefined) continue;
          const { result } = await request(`${api}/task_get/regular/${item.id}`);
          const entry: CacheEntry = { endpoint: `${api}/live/regular`, body: [tasks[i]], fetched_at: new Date(now()).toISOString(), cost: costs[i], result };
          await writeCache(cacheKey(entry.endpoint, entry.body), entry);
          out[i] = { result, cost: costs[i], cached: false, fetched_at: entry.fetched_at };
          pending.delete(item.id);
        }
        if (!pending.size) break;
        if (Date.now() + pollMs > deadline) throw new QueueTimeoutError([...pending.keys()], timeoutMs);
        await new Promise((r) => setTimeout(r, pollMs));
      }
      return out;
    },
  };
}
