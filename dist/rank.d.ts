import { type DataForSeoClient } from './client.js';
import { type Spend } from './checks.js';
/** Search terms `rankCheck` runs before it refuses. */
export declare const DEFAULT_RANK_MAX_KEYWORDS = 100;
/** Results read per search: Google's page one. */
export declare const DEFAULT_RANK_DEPTH = 10;
/** `queue` takes about 5 minutes, `priority` about 1, `live` a few seconds. */
export type RankMode = 'queue' | 'priority' | 'live';
/** USD for the first 10 results of one search. Each further 10 costs 75% of this. */
export declare const RANK_PRICES: Record<RankMode, number>;
/** The most `rankCheck` could cost for `terms` searches. DataForSEO bills deeper pages only when Google returns them. */
export declare function estimateRankCost(terms: number, mode?: RankMode, depth?: number): number;
/** One organic result. */
export interface SerpResult {
    position: number;
    domain: string;
    url: string;
}
/** Where the domain ranks for one search term. `position` is null outside `depth`. */
export interface RankTerm extends Spend {
    keyword: string;
    position: number | null;
    url: string | null;
    title: string | null;
    /** Other result types on the page, such as `featured_snippet`, `local_pack` or `people_also_ask`. */
    features: string[];
    top_3: SerpResult[];
}
/** What `rankCheck` returns. */
export interface RankCheckResult extends Spend {
    domain: string;
    location: string;
    language: string;
    device: 'desktop' | 'mobile';
    depth: number;
    mode: RankMode;
    terms: RankTerm[];
    summary: {
        top_3: number;
        page_one: number;
        lower: number;
        not_found: number;
    };
}
/** Input for `rankCheck`. */
export interface RankCheckInput {
    domain: string;
    keywords: string[];
    /** DataForSEO location name. Default: `DEFAULT_LOCATION`. */
    location?: string;
    /** DataForSEO language name. Default: `DEFAULT_LANGUAGE`. */
    language?: string;
    /** Default: `desktop`. */
    device?: 'desktop' | 'mobile';
    /** Results read per search, 10 to 100. Default: `DEFAULT_RANK_DEPTH`. */
    depth?: number;
    /** Default: `queue`. */
    mode?: RankMode;
    /** Throws before any call when there are more keywords. Default: `DEFAULT_RANK_MAX_KEYWORDS`. */
    max_keywords?: number;
    /** Wait between checks for finished tasks. Default: 10 seconds. */
    pollMs?: number;
    /** How long to wait for queued tasks. Default: 10 minutes. */
    timeoutMs?: number;
    /** Pay for fresh results instead of using the cache. */
    refresh?: boolean;
}
/** The domain's best organic result in a SERP result, with the page's other result types and top 3. */
export declare function parseSerp(result: any, domain: string): Pick<RankTerm, 'position' | 'url' | 'title' | 'features' | 'top_3'>;
/** Where a domain ranks on Google today for each search term: one search per term, queued or live. */
export declare function rankCheck(client: DataForSeoClient, input: RankCheckInput, now?: () => number): Promise<RankCheckResult>;
/** One term's change between two rank checks. Positions are null outside the checked depth; `change` is places gained. */
export interface RankMove {
    keyword: string;
    from: number | null;
    to: number | null;
    change: number | null;
    url: string | null;
}
/** Changes between two rank checks of the same terms. */
export interface RankDiff {
    /** Found now, not before. Best position first. */
    gained: RankMove[];
    /** Found before, not now. Best former position first. */
    lost: RankMove[];
    /** Biggest move first. */
    improved: RankMove[];
    declined: RankMove[];
    /** Same position, or not found either time. */
    unchanged: RankMove[];
    /** Results read per search in both checks. */
    depth: number;
    /** Terms in only one of the checks. */
    not_compared: string[];
}
/** Compares two rank checks for the same location, language and device. A deeper check is cut to the shallower one's depth. */
export declare function rankDiff(prev: RankCheckResult, next: RankCheckResult): RankDiff;
