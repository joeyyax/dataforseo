/** Key-value cache for paid responses. The client treats any throw as a miss. */
export interface CacheStore {
    get(key: string): Promise<unknown | null>;
    set(key: string, value: unknown, ttlMs: number): Promise<void>;
}
/** One JSON file per key. */
export declare function createDiskCacheStore(dir: string, now?: () => number): CacheStore;
