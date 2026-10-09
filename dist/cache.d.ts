/** Key-value cache for paid responses. The client treats any throw as a miss. */
export interface CacheStore {
    get(key: string): Promise<unknown | null>;
    set(key: string, value: unknown, ttlMs: number): Promise<void>;
}
/** A cache in `dir`, one JSON file per key. */
export declare function createDiskCacheStore(dir: string, now?: () => number): CacheStore;
/** Options for `createHttpCacheStore`. */
export interface HttpCacheStoreOptions {
    /** Base URL; keys go after it, e.g. `https://cache.example.com/dataforseo`. */
    url: string;
    /** Sent as `Authorization: Bearer <token>`. */
    token: string;
    /** Default: 3 seconds. */
    getTimeoutMs?: number;
    /** Default: 10 seconds. */
    setTimeoutMs?: number;
    fetchFn?: typeof fetch;
}
/**
 * A remote cache over HTTP: `GET {url}/{key}` returns `{ value }` or 404, `PUT {url}/{key}` takes `{ value, ttl_ms }`.
 * Timeouts, network errors and non-2xx responses throw, so the client logs them and calls live.
 */
export declare function createHttpCacheStore(opts: HttpCacheStoreOptions): CacheStore;
