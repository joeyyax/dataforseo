import { type CacheStore } from './cache.js';
/** How long paid responses stay cached: 7 days. */
export declare const DEFAULT_TTL_MS: number;
/** Per-request timeout: 30 seconds. */
export declare const DEFAULT_TIMEOUT_MS = 30000;
/** DataForSEO's status code for a used-up daily spend limit. */
export declare const DAILY_LIMIT_STATUS = 40203;
/** The daily-limit error as a plain sentence, with the limit when DataForSEO gives one. */
export declare function costLimitMessage(statusMessage: unknown): string;
/** The next midnight UTC, when the daily spend limit resets. */
export declare function nextUtcMidnight(at?: number): Date;
/** A DataForSEO error response. `status` is DataForSEO's status code, or the HTTP status when the body isn't JSON. */
export declare class DataForSeoError extends Error {
    readonly status: number | null;
    readonly endpoint: string;
    constructor(message: string, status: number | null, endpoint: string);
}
/** Status 40203: the account's daily spend limit is used up. */
export declare class DailyLimitError extends DataForSeoError {
    readonly status: typeof DAILY_LIMIT_STATUS;
    constructor(statusMessage: unknown, endpoint?: string);
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
    /** Account balance and limits. Free, so never cached. */
    userData(): Promise<Charged>;
    /** Sends one task to a live endpoint, through the cache. */
    live(endpoint: string, task: Record<string, unknown>, opts?: {
        refresh?: boolean;
        timeoutMs?: number;
    }): Promise<Charged>;
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
/** SHA-256 hex digest of the endpoint and request body. */
export declare function cacheKey(endpoint: string, body: unknown): string;
/** A DataForSEO client that caches paid responses. */
export declare function createDataForSeoClient(opts: DataForSeoOptions): DataForSeoClient;
