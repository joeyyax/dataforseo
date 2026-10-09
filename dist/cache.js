import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const KEY_RE = /^[a-f0-9]{16,128}$/;
/** A cache in `dir`, one JSON file per key. */
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
/**
 * A cache on your own server: `GET {url}/{key}` returns `{ value }` or 404 and `PUT {url}/{key}` takes `{ value, ttl_ms }`.
 * Errors and timeouts throw, so the client counts them as misses.
 */
export function createHttpCacheStore(opts) {
    const base = opts.url.replace(/\/+$/, '');
    const fetchFn = opts.fetchFn ?? fetch;
    const headers = { authorization: `Bearer ${opts.token}` };
    const urlFor = (key) => {
        if (!KEY_RE.test(key))
            throw new Error(`Invalid cache key "${key}".`);
        return `${base}/${key}`;
    };
    return {
        async get(key) {
            const res = await fetchFn(urlFor(key), { headers, signal: AbortSignal.timeout(opts.getTimeoutMs ?? 3_000) });
            if (res.status === 404)
                return null;
            if (!res.ok)
                throw new Error(`HTTP ${res.status} from ${base}`);
            const body = (await res.json());
            return body?.value ?? null;
        },
        async set(key, value, ttlMs) {
            const res = await fetchFn(urlFor(key), {
                method: 'PUT',
                headers: { ...headers, 'content-type': 'application/json' },
                body: JSON.stringify({ value, ttl_ms: ttlMs }),
                signal: AbortSignal.timeout(opts.setTimeoutMs ?? 10_000),
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status} from ${base}`);
        },
    };
}
