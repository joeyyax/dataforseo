import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const KEY_RE = /^[a-f0-9]{16,128}$/;
/** One JSON file per key. */
export function createDiskCacheStore(dir, now = Date.now) {
    const pathFor = (key) => {
        if (!KEY_RE.test(key))
            throw new Error(`Invalid cache key "${key}".`);
        return join(dir, `${key}.json`);
    };
    return {
        async get(key) {
            let entry;
            try {
                entry = JSON.parse(await readFile(pathFor(key), 'utf8'));
            }
            catch {
                return null;
            }
            if (!entry?.expires_at || now() >= Date.parse(entry.expires_at))
                return null;
            return entry.value;
        },
        async set(key, value, ttlMs) {
            const path = pathFor(key);
            await mkdir(dir, { recursive: true });
            const entry = { expires_at: new Date(now() + ttlMs).toISOString(), value };
            await writeFile(path, JSON.stringify(entry));
        },
    };
}
