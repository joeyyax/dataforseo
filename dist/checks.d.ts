import type { Charged, DataForSeoClient } from './client.js';
import { type RankedKeyword, type SnapshotDiff, type SnapshotStore } from './snapshots.js';
import { type Relevance, type TermKind, type Topic } from './relevance.js';
export declare const DEFAULT_LOCATION = "United States";
export declare const DEFAULT_LANGUAGE = "English";
export declare const MAPS_DEPTH = 20;
/** Snapshot and baseline pull the same 100 terms, so one cached call serves both. */
export declare const DEFAULT_SNAPSHOT_LIMIT = 100;
export declare const DEFAULT_BASELINE_LIMIT = 100;
export declare const DEFAULT_GAP_LIMIT = 100;
/** A competitor term counts only when the competitor is on page one for it. */
export declare const GAP_MAX_POSITION = 10;
export declare const DEFAULT_CANDIDATES = 10;
export declare const DISCOVERY_KEYWORDS = 20;
export declare const DEFAULT_MAX_KEYWORDS = 5;
export declare const DEFAULT_PROMPTS = 0;
export interface Spend {
    cost: number;
    cached: boolean;
    fetched_at: string;
}
/** Cost adds up; cached only when every call was; fetched_at is the oldest pull. */
export declare function combine(charges: Charged[], nowIso: string): Spend;
/** Same site: exact domain or a subdomain of it. */
export declare function sameSite(candidate: string | null | undefined, domain: string): boolean;
/** `money.statistics.day` cut to its USD `total`; the per-API keys do not track spend. */
export declare function daySpend(day: any): {
    date?: string;
    total?: number;
} | undefined;
export declare function balance(client: DataForSeoClient): Promise<{
    login: any;
    balance: any;
    deposited: any;
    spent: number | undefined;
    today: {
        date?: string;
        total?: number;
    } | undefined;
    cost: number;
    cached: boolean;
}>;
/** Today's spend against the account's daily limit, from the free user_data call. `limit` is null when none is set. */
export interface DailyBudget {
    date: string;
    spent: number;
    limit: number | null;
    left: number | null;
}
export declare function dailyBudget(client: DataForSeoClient, now?: () => number): Promise<DailyBudget>;
export interface Positions {
    top_3: number;
    '4_10': number;
    '11_20': number;
    '21_100': number;
}
export declare function parseRankedItem(item: any): RankedKeyword | null;
/** Pages among the pulled keywords, most estimated visits first. */
export declare function topPages(keywords: RankedKeyword[]): {
    url: string;
    keywords: number;
    etv: number;
}[];
interface Market {
    location?: string;
    language?: string;
    refresh?: boolean;
}
export type ClassifiedKeyword = RankedKeyword & {
    kind: TermKind;
    theme?: string;
};
/** What the relevance filter was given, so a report can say how terms were sorted. */
export interface RelevanceInput {
    brand?: string;
    aliases: string[];
    topics: Topic[];
    area: string[];
}
export interface SnapshotResult extends Spend {
    domain: string;
    location: string;
    language: string;
    est_monthly_visits: number;
    keywords_total: number;
    positions: Positions;
    relevance: RelevanceInput;
    /** The top terms by estimated visits, each sorted into brand, topic, someone else's name or unrelated. */
    top_keywords: ClassifiedKeyword[];
    top_pages: {
        url: string;
        keywords: number;
        etv: number;
    }[];
}
interface RelevanceArgs {
    brand?: string;
    aliases?: string[];
    topics?: string[];
    area?: string[];
}
export declare function seoSnapshot(client: DataForSeoClient, input: Market & RelevanceArgs & {
    domain: string;
    limit?: number;
    competitors?: string[];
}, now?: () => number): Promise<SnapshotResult>;
/**
 * `weak`: both rank and the competitor is ahead. `missing`: only the competitor ranks.
 * Every term here has at least one competitor on page one.
 */
export type GapKind = 'weak' | 'missing';
export interface GapTerm {
    keyword: string;
    search_volume: number;
    intent?: string;
    gap: GapKind;
    kind: TermKind;
    theme?: string;
    /** The domain's own position, for `weak` terms. */
    position: number | null;
    url: string | null;
    /** Best position first. */
    competitors: {
        domain: string;
        position: number;
        url: string;
    }[];
}
export interface GapPull {
    domain: string;
    /** `true` for terms both rank for, `false` for terms only the competitor ranks for. */
    shared: boolean;
    items: any[];
}
/** One term per keyword across competitors, kept when a competitor is on page one and ahead. */
export declare function mergeGaps(pulls: GapPull[], r: Relevance): GapTerm[];
export interface GapCompetitor {
    domain: string;
    /** Page-one terms the competitor ranks for that the domain doesn't, any topic, from DataForSEO's count. */
    missing_total: number;
    /** Page-one terms both rank for, any topic and either order. */
    shared_total: number;
    /** Terms pulled per type, most searched first. */
    checked: number;
}
export interface GapResult extends Spend {
    domain: string;
    location: string;
    language: string;
    limit: number;
    max_position: number;
    relevance: RelevanceInput;
    competitors: GapCompetitor[];
    /** Topic terms only: no names, nothing unrelated. */
    gaps: GapTerm[];
    /** Pulled page-one terms left out, by reason. */
    excluded: {
        brand: number;
        other_name: number;
        elsewhere: number;
        unrelated: number;
        ahead: number;
    };
    /** A few left-out terms per reason, so a reader can check the filter. */
    excluded_examples: {
        other_name: string[];
        elsewhere: string[];
        unrelated: string[];
    };
    gap_terms: number;
    gap_search_volume: number;
}
/**
 * Search terms where a named competitor is on Google's page one and the domain is behind it or absent:
 * two Labs domain_intersection calls per competitor, then the relevance filter.
 */
export declare function competitorGap(client: DataForSeoClient, input: Market & RelevanceArgs & {
    domain: string;
    competitors: string[];
    limit?: number;
}, now?: () => number): Promise<GapResult>;
export declare function isNoiseCompetitor(domain: string): boolean;
export interface CompetitorCandidate {
    domain: string;
    /** How many of the discovery keywords the domain ranks for. */
    keywords_matched: number;
    avg_position: number;
    /** Estimated monthly visits the domain gets from the discovery keywords. */
    etv: number;
}
export interface DiscoveryKeyword {
    keyword: string;
    search_volume: number;
    /** The domain's own position, when the keyword came from its rankings. */
    position?: number;
}
export interface CandidatesResult extends Spend {
    domain: string;
    location: string;
    language: string;
    keywords_source: 'rankings' | 'given';
    keywords_used: DiscoveryKeyword[];
    candidates: CompetitorCandidate[];
    filtered_out: string[];
    note: string;
}
/**
 * Domains ranking for the same search terms: the caller's keywords, or the domain's own top
 * non-brand keywords from the same ranked_keywords pull as seo_snapshot, so a recent snapshot makes that step free.
 */
export declare function competitorCandidates(client: DataForSeoClient, input: Market & {
    domain: string;
    brand?: string;
    keywords?: string[];
    limit?: number;
}, now?: () => number): Promise<CandidatesResult>;
export interface MapsListing {
    position: number;
    title: string;
    domain: string | null;
    rating: number | null;
    reviews: number | null;
    category: string | null;
}
export declare function parseMapsItems(result: any): MapsListing[];
/** By website domain first, then by business name either way round. */
export declare function matchesBusiness(listing: MapsListing, business: string, domain?: string): boolean;
export interface LocalResult extends Spend {
    business: string;
    domain?: string;
    location: string;
    language: string;
    results: {
        keyword: string;
        position: number | null;
        listing: MapsListing | null;
        top_3: MapsListing[];
    }[];
    summary: {
        top_3: number;
        lower: number;
        not_found: number;
    };
}
export declare function localVisibility(client: DataForSeoClient, input: {
    business: string;
    domain?: string;
    keywords: string[];
    location: string;
    language?: string;
    max_keywords?: number;
    refresh?: boolean;
}, now?: () => number): Promise<LocalResult>;
export interface MentionCounts {
    total: number;
    by_platform: Record<string, number>;
}
export interface AiTopic {
    keyword: string;
    mentions: number;
    cited: boolean;
    top_sources: {
        domain: string;
        mentions: number;
    }[];
}
export interface AiPrompt {
    question: string;
    platform: string;
    ai_search_volume: number;
    url: string | null;
}
export interface AiResult extends Spend {
    domain: string;
    brand?: string;
    citations: MentionCounts;
    brand_mentions?: MentionCounts;
    topics: AiTopic[];
    top_prompts: AiPrompt[];
}
export declare function aiVisibility(client: DataForSeoClient, input: {
    domain: string;
    brand?: string;
    keywords?: string[];
    prompts?: number;
    refresh?: boolean;
}, now?: () => number): Promise<AiResult>;
export interface BaselineResult extends Spend {
    snapshot_id: string;
    domain: string;
    location: string;
    language: string;
    limit: number;
    keywords_tracked: number;
    keywords_total: number;
    est_monthly_visits: number;
    positions: Positions;
    keywords: RankedKeyword[];
    /** `same_data` when both snapshots hold the same DataForSEO pull, so nothing can have moved. `compared_terms` is the top-N both sides were cut to; `trimmed` when either held more. */
    compared_to: {
        id: string;
        created: string;
        fetched_at: string;
        keywords_tracked: number;
        same_data: boolean;
        compared_terms: number;
        trimmed: boolean;
    } | null;
    diff: SnapshotDiff | null;
}
export declare function rankBaseline(client: DataForSeoClient, snapshots: SnapshotStore, input: Market & {
    domain: string;
    label?: string;
    compare_to?: string;
    limit?: number;
}, now?: () => number): Promise<BaselineResult>;
export {};
