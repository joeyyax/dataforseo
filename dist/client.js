import { createHash } from 'node:crypto';
import { createDiskCacheStore } from './cache.js';
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
export function costLimitMessage(statusMessage) {
    const limit = Number(String(statusMessage ?? '').match(/>=\s*([\d.]+)/)?.[1]);
    const amount = Number.isFinite(limit) ? ` ($${Number.isInteger(limit) ? limit : limit.toFixed(2)})` : '';
    return `DataForSEO's daily spend limit${amount} is used up. It resets at midnight UTC.`;
}
/** The next midnight UTC, when the daily spend limit resets. */
export function nextUtcMidnight(at = Date.now()) {
    const d = new Date(at);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}
/** A DataForSEO error response. `status` is DataForSEO's status code, or the HTTP status when the body isn't JSON. */
export class DataForSeoError extends Error {
    status;
    endpoint;
    constructor(message, status, endpoint) {
        super(message);
        this.status = status;
        this.endpoint = endpoint;
        this.name = 'DataForSeoError';
    }
}
/** Status 40203: the account's daily spend limit is used up. */
export class DailyLimitError extends DataForSeoError {
    constructor(statusMessage, endpoint = '', message = costLimitMessage(statusMessage)) {
        super(message, DAILY_LIMIT_STATUS, endpoint);
        this.name = 'DailyLimitError';
    }
}
/** Thrown when queued tasks aren't ready in time. They're paid for; `ids` collects them later. */
export class QueueTimeoutError extends Error {
    ids;
    constructor(ids, timeoutMs) {
        super(`${ids.length} queued ${ids.length === 1 ? 'task wasn\'t' : 'tasks weren\'t'} ready after ${Math.round(timeoutMs / 1000)} seconds. DataForSEO keeps results for 30 days: ${ids.join(', ')}.`);
        this.ids = ids;
        this.name = 'QueueTimeoutError';
    }
}
function isEntry(v) {
    return !!v && typeof v === 'object' && typeof v.fetched_at === 'string' && 'result' in v;
}
/** SHA-256 hex digest of the endpoint and request body. */
export function cacheKey(endpoint, body) {
    return createHash('sha256').update(`${endpoint}\n${JSON.stringify(body)}`).digest('hex');
}
/** A DataForSEO client that caches paid responses. */
export function createDataForSeoClient(opts) {
    const fetchFn = opts.fetchFn ?? fetch;
    const now = opts.now ?? Date.now;
    const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    const cache = opts.cache ?? (opts.cacheDir ? createDiskCacheStore(opts.cacheDir, now) : undefined);
    const onCacheError = opts.onCacheError
        ?? ((op, err) => console.error(`dataforseo cache ${op} failed: ${err instanceof Error ? err.message : String(err)}`));
    function requireCredentials() {
        if (!opts.login || !opts.password) {
            throw new Error('DataForSEO is not configured: set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD.');
        }
        return `Basic ${Buffer.from(`${opts.login}:${opts.password}`).toString('base64')}`;
    }
    async function send(endpoint, body, timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) {
        const auth = requireCredentials();
        const res = await fetchFn(`${BASE_URL}${endpoint}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        }
        catch {
            throw new DataForSeoError(`DataForSEO ${endpoint} ${res.status}: ${text.slice(0, 300)}`, res.status, endpoint);
        }
        if (data?.status_code === DAILY_LIMIT_STATUS)
            throw new DailyLimitError(data.status_message, endpoint);
        if (!res.ok || data?.status_code !== OK) {
            const status = data?.status_code ?? res.status;
            throw new DataForSeoError(`DataForSEO ${endpoint} ${status}: ${data?.status_message ?? text.slice(0, 300)}`, status, endpoint);
        }
        return data;
    }
    function checkTask(endpoint, task, ok = OK) {
        if (task?.status_code === DAILY_LIMIT_STATUS)
            throw new DailyLimitError(task.status_message, endpoint);
        if (!task || task.status_code !== ok) {
            const message = `DataForSEO ${endpoint} task ${task?.status_code ?? 'missing'}: ${task?.status_message ?? 'no task in response'}`;
            throw new DataForSeoError(message, task?.status_code ?? null, endpoint);
        }
    }
    async function request(endpoint, body, timeoutMs) {
        const data = await send(endpoint, body, timeoutMs);
        const task = data.tasks?.[0];
        checkTask(endpoint, task);
        return { result: task.result?.[0] ?? null, cost: Number(data.cost ?? 0) };
    }
    async function readCache(key) {
        if (!cache)
            return null;
        try {
            const hit = await cache.get(key);
            return isEntry(hit) ? hit : null;
        }
        catch (err) {
            onCacheError('get', err);
            return null;
        }
    }
    async function writeCache(key, entry) {
        if (!cache)
            return;
        try {
            await cache.set(key, entry, ttlMs);
        }
        catch (err) {
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
                if (hit)
                    return { result: hit.result, cost: 0, cached: true, fetched_at: hit.fetched_at };
            }
            const { result, cost } = await request(endpoint, body, timeoutMs);
            const entry = { endpoint, body, fetched_at: new Date(now()).toISOString(), cost, result };
            await writeCache(key, entry);
            return { result, cost, cached: false, fetched_at: entry.fetched_at };
        },
        async cached(endpoint, task) {
            const hit = await readCache(cacheKey(endpoint, [task]));
            return hit ? { result: hit.result, cost: 0, cached: true, fetched_at: hit.fetched_at } : null;
        },
        async queued(api, tasks, { priority = false, pollMs = 10_000, timeoutMs = 600_000 } = {}) {
            requireCredentials();
            const post = `${api}/task_post`;
            const ids = [];
            const costs = [];
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
            const out = new Array(tasks.length);
            const pending = new Map(ids.map((id, i) => [id, i]));
            const deadline = Date.now() + timeoutMs;
            while (pending.size) {
                const ready = await send(`${api}/tasks_ready`);
                for (const item of ready.tasks?.[0]?.result ?? []) {
                    const i = pending.get(item?.id);
                    if (i === undefined)
                        continue;
                    const { result } = await request(`${api}/task_get/regular/${item.id}`);
                    const entry = { endpoint: `${api}/live/regular`, body: [tasks[i]], fetched_at: new Date(now()).toISOString(), cost: costs[i], result };
                    await writeCache(cacheKey(entry.endpoint, entry.body), entry);
                    out[i] = { result, cost: costs[i], cached: false, fetched_at: entry.fetched_at };
                    pending.delete(item.id);
                }
                if (!pending.size)
                    break;
                if (Date.now() + pollMs > deadline)
                    throw new QueueTimeoutError([...pending.keys()], timeoutMs);
                await new Promise((r) => setTimeout(r, pollMs));
            }
            return out;
        },
    };
}
