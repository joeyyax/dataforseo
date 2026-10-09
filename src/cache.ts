import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Key-value cache for paid responses. The client treats any throw as a miss. */
export interface CacheStore {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
}

interface DiskEntry {
  expires_at: string;
  value: unknown;
}

const KEY_RE = /^[a-f0-9]{16,128}$/;

/** One JSON file per key. */
export function createDiskCacheStore(dir: string, now: () => number = Date.now): CacheStore {
  const pathFor = (key: string) => {
    if (!KEY_RE.test(key)) throw new Error(`Invalid cache key "${key}".`);
    return join(dir, `${key}.json`);
  };
  return {
    async get(key) {
      let entry: DiskEntry;
      try {
        entry = JSON.parse(await readFile(pathFor(key), 'utf8')) as DiskEntry;
      } catch {
        return null;
      }
      if (!entry?.expires_at || now() >= Date.parse(entry.expires_at)) return null;
      return entry.value;
    },
    async set(key, value, ttlMs) {
      const path = pathFor(key);
      await mkdir(dir, { recursive: true });
      const entry: DiskEntry = { expires_at: new Date(now() + ttlMs).toISOString(), value };
      await writeFile(path, JSON.stringify(entry));
    },
  };
}

export interface HttpCacheStoreOptions {
  /** Base URL; keys go after it, e.g. `https://cache.example.com/dataforseo`. */
  url: string;
  token: string;
  /** Per-request timeouts. Defaults: 3s for get, 10s for set. */
  getTimeoutMs?: number;
  setTimeoutMs?: number;
  fetchFn?: typeof fetch;
}

/**
 * A remote cache over HTTP: `GET {url}/{key}` returns `{ value }` or 404, `PUT {url}/{key}` takes `{ value, ttl_ms }`.
 * Timeouts, network errors and non-2xx responses throw, so the client logs them and calls live.
 */
export function createHttpCacheStore(opts: HttpCacheStoreOptions): CacheStore {
  const base = opts.url.replace(/\/+$/, '');
  const fetchFn = opts.fetchFn ?? fetch;
  const headers = { authorization: `Bearer ${opts.token}` };
  const urlFor = (key: string) => {
    if (!KEY_RE.test(key)) throw new Error(`Invalid cache key "${key}".`);
    return `${base}/${key}`;
  };
  return {
    async get(key) {
      const res = await fetchFn(urlFor(key), { headers, signal: AbortSignal.timeout(opts.getTimeoutMs ?? 3_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${base}`);
      const body = (await res.json()) as { value?: unknown };
      return body?.value ?? null;
    },
    async set(key, value, ttlMs) {
      const res = await fetchFn(urlFor(key), {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ value, ttl_ms: ttlMs }),
        signal: AbortSignal.timeout(opts.setTimeoutMs ?? 10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${base}`);
    },
  };
}
