import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]{0,252}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
function assertDomain(domain) {
    if (!DOMAIN_RE.test(domain))
        throw new Error(`Invalid domain "${domain}".`);
    return domain;
}
function assertId(id) {
    if (!ID_RE.test(id))
        throw new Error(`Invalid snapshot id "${id}".`);
    return id;
}
/** `2026-10-08T17:53:00.123Z` + "Pre launch" → `20261008-175300-pre-launch`. */
export function snapshotId(createdIso, label) {
    const stamp = createdIso.replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-').replace(/Z$/, '');
    const tag = (label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return tag ? `${stamp}-${tag}` : stamp;
}
/** A snapshot store in `dir`, one folder per domain and one JSON file per snapshot. */
export function createDiskSnapshotStore(dir) {
    const domainDir = (domain) => join(dir, assertDomain(domain));
    return {
        async save(snapshot) {
            const target = domainDir(snapshot.domain);
            await mkdir(target, { recursive: true });
            await writeFile(join(target, `${assertId(snapshot.id)}.json`), JSON.stringify(snapshot), 'utf8');
        },
        async get(domain, id) {
            try {
                return JSON.parse(await readFile(join(domainDir(domain), `${assertId(id)}.json`), 'utf8'));
            }
            catch (err) {
                if (err.code === 'ENOENT')
                    throw new Error(`No snapshot "${id}" for ${domain}.`);
                throw err;
            }
        },
        async list(domain) {
            let files;
            try {
                files = await readdir(domainDir(domain));
            }
            catch {
                return [];
            }
            const snaps = [];
            for (const f of files.filter((f) => f.endsWith('.json'))) {
                try {
                    snaps.push(JSON.parse(await readFile(join(domainDir(domain), f), 'utf8')));
                }
                catch { /* skip unreadable files */ }
            }
            return snaps.sort((a, b) => a.created.localeCompare(b.created));
        },
    };
}
/** @deprecated Use `createDiskSnapshotStore`. */
export const createSnapshotStore = createDiskSnapshotStore;
/** Lower position is better. Gained and lost are relative to the tracked set, not all of Google. */
export function diffSnapshots(prev, cur) {
    const before = new Map(prev.keywords.map((k) => [k.keyword, k]));
    const after = new Map(cur.keywords.map((k) => [k.keyword, k]));
    const diff = { gained: [], lost: [], improved: [], declined: [], unchanged: 0 };
    for (const k of cur.keywords) {
        const old = before.get(k.keyword);
        const move = { keyword: k.keyword, search_volume: k.search_volume, from: old?.position ?? null, to: k.position, url: k.url };
        if (!old)
            diff.gained.push(move);
        else if (k.position < old.position)
            diff.improved.push(move);
        else if (k.position > old.position)
            diff.declined.push(move);
        else
            diff.unchanged++;
    }
    for (const k of prev.keywords) {
        if (!after.has(k.keyword))
            diff.lost.push({ keyword: k.keyword, search_volume: k.search_volume, from: k.position, to: null, url: k.url });
    }
    const byVolume = (a, b) => b.search_volume - a.search_volume;
    diff.gained.sort(byVolume);
    diff.lost.sort(byVolume);
    diff.improved.sort(byVolume);
    diff.declined.sort(byVolume);
    return diff;
}
/** Terms the snapshot was asked to hold. */
export function snapshotLimit(s) {
    return s.limit ?? s.keywords.length;
}
/** The first `n` terms, in the order the snapshot holds them (most estimated visits first). */
export function trimSnapshot(s, n) {
    return s.keywords.length > n ? { ...s, keywords: s.keywords.slice(0, n) } : s;
}
