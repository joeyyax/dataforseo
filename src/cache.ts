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
