import type { Charged, DataForSeoClient } from './client.js';
import { type RankedKeyword, type SnapshotDiff, type SnapshotStore } from './snapshots.js';
import { type Relevance, type TermKind, type Topic } from './relevance.js';
/** DataForSEO location name used when none is given. */
export declare const DEFAULT_LOCATION = "United States";
/** DataForSEO language name used when none is given. */
export declare const DEFAULT_LANGUAGE = "English";
/** Maps results read per search. */
export declare const MAPS_DEPTH = 20;
/** Snapshot and baseline pull the same 100 terms, so one cached call serves both. */
export declare const DEFAULT_SNAPSHOT_LIMIT = 100;
/** Terms a ranking baseline tracks. */
export declare const DEFAULT_BASELINE_LIMIT = 100;
/** Terms pulled per competitor and gap type. */
export declare const DEFAULT_GAP_LIMIT = 100;
/** A competitor term counts only when the competitor is on page one for it. */
export declare const GAP_MAX_POSITION = 10;
/** Competitor candidates returned. */
export declare const DEFAULT_CANDIDATES = 10;
/** Search terms competitor discovery compares on. */
export declare const DISCOVERY_KEYWORDS = 20;
/** Maps searches `localVisibility` runs before it refuses. */
export declare const DEFAULT_MAX_KEYWORDS = 5;
/** AI prompts pulled by default: none, since that call costs extra. */
export declare const DEFAULT_PROMPTS = 0;
/** What a check cost and how fresh its data is. */
export interface Spend {
    cost: number;
    cached: boolean;
    fetched_at: string;
}
/** Several calls as one: total cost, cached only when all were and the oldest `fetched_at`. */
export declare function combine(charges: Charged[], nowIso: string): Spend;
/** Same site: exact domain or a subdomain of it. */
export declare function sameSite(candidate: string | null | undefined, domain: string): boolean;
/** Today's date and USD spend from user_data's `money.statistics.day`. */
export declare function daySpend(day: any): {
    date?: string;
    total?: number;
} | undefined;
/** Account balance and spend from `balance`. Amounts are USD. */
export interface Balance {
    login?: string;
    balance?: number;
    deposited?: number;
    spent?: number;
    today?: {
        date?: string;
        total?: number;
    };
    cost: number;
    cached: boolean;
}
/** Account balance, total deposits and spend, from the free user_data call. */
export declare function balance(client: DataForSeoClient): Promise<Balance>;
/** Today's spend against the account's daily limit, from the free user_data call. `limit` is null when none is set. */
export interface DailyBudget {
    date: string;
    spent: number;
    limit: number | null;
    left: number | null;
}
/** Today's spend against the daily limit. Free. */
export declare function dailyBudget(client: DataForSeoClient, now?: () => number): Promise<DailyBudget>;
/** Ranking terms per position band. */
export interface Positions {
    top_3: number;
    '4_10': number;
    '11_20': number;
    '21_100': number;
}
/** One ranked_keywords item as a `RankedKeyword`, or null when it has no keyword or result. */
export declare function parseRankedItem(item: any): RankedKeyword | null;
/** Pages among the pulled keywords, most estimated visits first. */
export declare function topPages(keywords: RankedKeyword[]): {
    url: string;
    keywords: number;
    etv: number;
}[];
/** Where to search and whether to skip the cache. */
export interface Market {
    /** DataForSEO location name. Default: `DEFAULT_LOCATION`. */
    location?: string;
    /** DataForSEO language name. Default: `DEFAULT_LANGUAGE`. */
    language?: string;
    /** Pay for fresh data instead of using the cache. */
    refresh?: boolean;
}
/** A ranking term with its `TermKind` and topic. */
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
/** What `seoSnapshot` returns. */
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
/** How to sort terms by relevance. Without `topics`, terms stay unsorted. */
export interface RelevanceOptions {
    /** The business name as people search for it. */
    brand?: string;
    /** Other names for the business. */
    aliases?: string[];
    /** `"Label: word, word"` or a bare word. */
    topics?: string[];
    /** Places the business serves. Terms naming other US places count as `elsewhere`. */
    area?: string[];
}
/** Input for `seoSnapshot`. */
export interface SnapshotInput extends Market, RelevanceOptions {
    domain: string;
    /** Default: `DEFAULT_SNAPSHOT_LIMIT`. */
    limit?: number;
    /** Their names count as `other-name`. */
    competitors?: string[];
}
/** A domain's Google rankings, estimated visits and top pages: one Labs call. */
export declare function seoSnapshot(client: DataForSeoClient, input: SnapshotInput, now?: () => number): Promise<SnapshotResult>;
/**
 * `weak`: both rank and the competitor is ahead. `missing`: only the competitor ranks.
 * Every term here has at least one competitor on page one.
 */
export type GapKind = 'weak' | 'missing';
/** One search term where a competitor is ahead. */
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
/** One domain_intersection result, as `mergeGaps` takes it. */
export interface GapPull {
    domain: string;
    /** `true` for terms both rank for, `false` for terms only the competitor ranks for. */
    shared: boolean;
    items: any[];
}
/** One term per keyword across competitors, kept when a competitor is on page one and ahead. */
export declare function mergeGaps(pulls: GapPull[], r: Relevance): GapTerm[];
/** Per-competitor totals in a gap result. */
export interface GapCompetitor {
    domain: string;
    /** Page-one terms the competitor ranks for that the domain doesn't, any topic, from DataForSEO's count. */
    missing_total: number;
    /** Page-one terms both rank for, any topic and either order. */
    shared_total: number;
    /** Terms pulled per type, most searched first. */
    checked: number;
}
/** What `competitorGap` returns. */
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
/** Input for `competitorGap`. */
export interface GapInput extends Market, RelevanceOptions {
    domain: string;
    /** At least one, other than the domain. */
    competitors: string[];
    /** Default: `DEFAULT_GAP_LIMIT`. */
    limit?: number;
}
/** Search terms where a competitor is on Google's page one and the domain is lower or missing: two calls per competitor. */
export declare function competitorGap(client: DataForSeoClient, input: GapInput, now?: () => number): Promise<GapResult>;
/** True for directories, social sites, reference sites and public bodies. */
export declare function isNoiseCompetitor(domain: string): boolean;
/** A domain that ranks for the same terms. */
export interface CompetitorCandidate {
    domain: string;
    /** How many of the discovery keywords the domain ranks for. */
    keywords_matched: number;
    avg_position: number;
    /** Estimated monthly visits the domain gets from the discovery keywords. */
    etv: number;
}
/** A term competitor discovery compared on. */
export interface DiscoveryKeyword {
    keyword: string;
    search_volume: number;
    /** The domain's own position, when the keyword came from its rankings. */
    position?: number;
}
/** What `competitorCandidates` returns. */
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
/** Input for `competitorCandidates`. */
export interface CandidatesInput extends Market {
    domain: string;
    /** Terms with this name are left out of discovery. */
    brand?: string;
    /** Terms to compare on. Default: the domain's top non-brand terms. */
    keywords?: string[];
    /** Default: `DEFAULT_CANDIDATES`. */
    limit?: number;
}
/** Domains that rank for the same terms: the given keywords, or the domain's top non-brand terms from the `seoSnapshot` call. */
export declare function competitorCandidates(client: DataForSeoClient, input: CandidatesInput, now?: () => number): Promise<CandidatesResult>;
/** One Google Maps result. */
export interface MapsListing {
    position: number;
    title: string;
    domain: string | null;
    rating: number | null;
    reviews: number | null;
    category: string | null;
    /** The listing's website. */
    url?: string | null;
    /** The listing on Google Maps. */
    maps_url?: string | null;
}
/** The Maps listings in a maps/live/advanced result, ads left out. */
export declare function parseMapsItems(result: any): MapsListing[];
/** By website domain first, then by business name either way round. */
export declare function matchesBusiness(listing: MapsListing, business: string, domain?: string): boolean;
/** What `localVisibility` returns. */
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
/** Input for `localVisibility`. */
export interface LocalInput {
    /** The business name as it appears on Google Maps. */
    business: string;
    /** Matches listings by website. Default: `business` when it looks like a domain. */
    domain?: string;
    /** One paid Maps search each. */
    keywords: string[];
    /** A DataForSEO location name or `lat,lng[,zoom]`. */
    location: string;
    /** Default: `DEFAULT_LANGUAGE`. */
    language?: string;
    /** Throws before any call when there are more keywords. Default: `DEFAULT_MAX_KEYWORDS`. */
    max_keywords?: number;
    refresh?: boolean;
}
/** Where a business shows in Google Maps for each search: one call per keyword. */
export declare function localVisibility(client: DataForSeoClient, input: LocalInput, now?: () => number): Promise<LocalResult>;
/** Answer counts, total and per AI platform. */
export interface MentionCounts {
    total: number;
    by_platform: Record<string, number>;
}
/** AI answers to questions containing one topic, and the sites they cite most. */
export interface AiTopic {
    keyword: string;
    mentions: number;
    cited: boolean;
    top_sources: {
        domain: string;
        mentions: number;
    }[];
}
/** A question whose AI answer cites the domain. */
export interface AiPrompt {
    question: string;
    platform: string;
    ai_search_volume: number;
    url: string | null;
}
/** What `aiVisibility` returns. */
export interface AiResult extends Spend {
    domain: string;
    brand?: string;
    citations: MentionCounts;
    brand_mentions?: MentionCounts;
    topics: AiTopic[];
    top_prompts: AiPrompt[];
}
/** Input for `aiVisibility`. */
export interface AiInput {
    domain: string;
    /** Counts answers that name it. */
    brand?: string;
    /** Topics to check who AI answers cite. */
    keywords?: string[];
    /** Top questions citing the domain to pull, in one extra call. Default: `DEFAULT_PROMPTS`. */
    prompts?: number;
    refresh?: boolean;
}
/** How often ChatGPT and Google AI Overviews cite the domain and name the brand. */
export declare function aiVisibility(client: DataForSeoClient, input: AiInput, now?: () => number): Promise<AiResult>;
/** What `rankBaseline` returns. */
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
    /** `same_data`: both hold the same pull, so nothing moved. Both sides are cut to `compared_terms`; `trimmed` says one held more. */
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
/** Input for `rankBaseline`. */
export interface BaselineInput extends Market {
    domain: string;
    /** Added to the snapshot id, e.g. "Pre launch". */
    label?: string;
    /** A snapshot id to compare with. Default: the most recent one before it for the same market. */
    compare_to?: string;
    /** Default: `DEFAULT_BASELINE_LIMIT`. */
    limit?: number;
}
/** Saves the domain's top terms and positions, then compares them with an earlier snapshot. */
export declare function rankBaseline(client: DataForSeoClient, snapshots: SnapshotStore, input: BaselineInput, now?: () => number): Promise<BaselineResult>;
