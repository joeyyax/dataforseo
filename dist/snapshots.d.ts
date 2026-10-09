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
/** `2026-10-08T17:53:00.123Z` + "Pre launch" → `20261008-175300-pre-launch`. */
export declare function snapshotId(createdIso: string, label?: string): string;
/** A snapshot store in `dir`, one folder per domain and one JSON file per snapshot. */
export declare function createDiskSnapshotStore(dir: string): SnapshotStore;
/** @deprecated Use `createDiskSnapshotStore`. */
export declare const createSnapshotStore: typeof createDiskSnapshotStore;
/** Lower position is better. Gained and lost are relative to the tracked set, not all of Google. */
export declare function diffSnapshots(prev: RankSnapshot, cur: RankSnapshot): SnapshotDiff;
/** Terms the snapshot was asked to hold. */
export declare function snapshotLimit(s: RankSnapshot): number;
/** The first `n` terms, in the order the snapshot holds them (most estimated visits first). */
export declare function trimSnapshot(s: RankSnapshot, n: number): RankSnapshot;
