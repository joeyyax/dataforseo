import { type CacheStore } from './cache.js';
export declare const DEFAULT_TTL_MS: number;
export declare const DEFAULT_TIMEOUT_MS = 30000;
export declare const DAILY_LIMIT_STATUS = 40203;
/** 40203 as a plain message, e.g. "money limit per day has been exceeded: 1.09792 >= 1". */
export declare function costLimitMessage(statusMessage: unknown): string;
/** The next midnight UTC, when the daily spend limit resets. */
export declare function nextUtcMidnight(at?: number): Date;
/** Status 40203: the account's daily spend limit is used up. */
export declare class DailyLimitError extends Error {
    readonly status = 40203;
    constructor(statusMessage: unknown);
}
/** One DataForSEO call. `cost` is USD for this call: 0 when served from cache. */
export interface Charged<T = any> {
    result: T;
    cost: number;
    cached: boolean;
    fetched_at: string;
}
export interface DataForSeoClient {
    /** Account money and limits. The endpoint is free, so it is never cached. */
    userData(): Promise<Charged>;
    /** POSTs one task to a live endpoint, through the cache. */
    live(endpoint: string, task: Record<string, unknown>, opts?: {
        refresh?: boolean;
        timeoutMs?: number;
    }): Promise<Charged>;
}
export interface DataForSeoOptions {
    login: string;
    password: string;
    /** Where paid responses are cached. Takes precedence over `cacheDir`. */
    cache?: CacheStore;
    /** Shorthand for a disk cache in this directory. */
    cacheDir?: string;
    ttlMs?: number;
    timeoutMs?: number;
    fetchFn?: typeof fetch;
    now?: () => number;
    /** Where cache failures are reported. */
    onCacheError?: (op: 'get' | 'set', err: unknown) => void;
}
export declare function cacheKey(endpoint: string, body: unknown): string;
export declare function createDataForSeoClient(opts: DataForSeoOptions): DataForSeoClient;
