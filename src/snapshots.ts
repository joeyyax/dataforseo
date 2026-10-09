import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]{0,252}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;

/** One ranking term. `etv` is estimated monthly visits from it. */
export interface RankedKeyword {
  keyword: string;
  position: number;
  search_volume: number;
  etv: number;
  url: string;
  /** DataForSEO's main search intent: informational, navigational, commercial or transactional. */
  intent?: string;
}

/** A saved set of rankings for one domain and market. */
export interface RankSnapshot {
  id: string;
  domain: string;
  label?: string;
  location: string;
  language: string;
  created: string;
  /** Terms requested; absent on older snapshots, which fall back to the terms held. */
  limit?: number;
  /** When DataForSEO pulled the data; older than `created` on a cache hit. */
  fetched_at: string;
  total_keywords: number;
  etv: number;
  keywords: RankedKeyword[];
}

/** One term's position change. `null` means outside the tracked set. */
export interface KeywordMove {
  keyword: string;
  search_volume: number;
  from: number | null;
  to: number | null;
  url: string;
}

/** Changes between two snapshots, each list most searched first. */
export interface SnapshotDiff {
  gained: KeywordMove[];
  lost: KeywordMove[];
  improved: KeywordMove[];
  declined: KeywordMove[];
  unchanged: number;
}

/** Where `rankBaseline` saves and finds snapshots. */
export interface SnapshotStore {
  save(snapshot: RankSnapshot): Promise<void>;
  get(domain: string, id: string): Promise<RankSnapshot>;
  /** Oldest first. */
  list(domain: string): Promise<RankSnapshot[]>;
}

function assertDomain(domain: string): string {
  if (!DOMAIN_RE.test(domain)) throw new Error(`Invalid domain "${domain}".`);
  return domain;
}

function assertId(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`Invalid snapshot id "${id}".`);
  return id;
}

/** `2026-10-08T17:53:00.123Z` + "Pre launch" → `20261008-175300-pre-launch`. */
export function snapshotId(createdIso: string, label?: string): string {
  const stamp = createdIso.replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-').replace(/Z$/, '');
  const tag = (label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return tag ? `${stamp}-${tag}` : stamp;
}

/** A snapshot store in `dir`, one folder per domain and one JSON file per snapshot. */
export function createDiskSnapshotStore(dir: string): SnapshotStore {
  const domainDir = (domain: string) => join(dir, assertDomain(domain));
  return {
    async save(snapshot) {
      const target = domainDir(snapshot.domain);
      await mkdir(target, { recursive: true });
      await writeFile(join(target, `${assertId(snapshot.id)}.json`), JSON.stringify(snapshot), 'utf8');
    },

    async get(domain, id) {
      try {
        return JSON.parse(await readFile(join(domainDir(domain), `${assertId(id)}.json`), 'utf8')) as RankSnapshot;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`No snapshot "${id}" for ${domain}.`);
        throw err;
      }
    },

    async list(domain) {
      let files: string[];
      try {
        files = await readdir(domainDir(domain));
      } catch {
        return [];
      }
      const snaps: RankSnapshot[] = [];
      for (const f of files.filter((f) => f.endsWith('.json'))) {
        try {
          snaps.push(JSON.parse(await readFile(join(domainDir(domain), f), 'utf8')) as RankSnapshot);
        } catch { /* skip unreadable files */ }
      }
      return snaps.sort((a, b) => a.created.localeCompare(b.created));
    },
  };
}

/** @deprecated Use `createDiskSnapshotStore`. */
export const createSnapshotStore = createDiskSnapshotStore;

/** Lower position is better. Gained and lost are relative to the tracked set, not all of Google. */
export function diffSnapshots(prev: RankSnapshot, cur: RankSnapshot): SnapshotDiff {
  const before = new Map(prev.keywords.map((k) => [k.keyword, k]));
  const after = new Map(cur.keywords.map((k) => [k.keyword, k]));
  const diff: SnapshotDiff = { gained: [], lost: [], improved: [], declined: [], unchanged: 0 };

  for (const k of cur.keywords) {
    const old = before.get(k.keyword);
    const move = { keyword: k.keyword, search_volume: k.search_volume, from: old?.position ?? null, to: k.position, url: k.url };
    if (!old) diff.gained.push(move);
    else if (k.position < old.position) diff.improved.push(move);
    else if (k.position > old.position) diff.declined.push(move);
    else diff.unchanged++;
  }
  for (const k of prev.keywords) {
    if (!after.has(k.keyword)) diff.lost.push({ keyword: k.keyword, search_volume: k.search_volume, from: k.position, to: null, url: k.url });
  }

  const byVolume = (a: KeywordMove, b: KeywordMove) => b.search_volume - a.search_volume;
  diff.gained.sort(byVolume);
  diff.lost.sort(byVolume);
  diff.improved.sort(byVolume);
  diff.declined.sort(byVolume);
  return diff;
}

/** Terms the snapshot was asked to hold. */
export function snapshotLimit(s: RankSnapshot): number {
  return s.limit ?? s.keywords.length;
}

/** The first `n` terms, in the order the snapshot holds them (most estimated visits first). */
export function trimSnapshot(s: RankSnapshot, n: number): RankSnapshot {
  return s.keywords.length > n ? { ...s, keywords: s.keywords.slice(0, n) } : s;
}
