import { type DataForSeoClient } from './client.js';
export declare const DEFAULT_REDIRECT_LIMIT = 100;
export type RedirectVerdict = 'ok' | 'redirect-ok' | '404' | 'gated' | 'other';
/** Old URLs that land on the same path on the new origin. `referring_domains` is their sum. */
export interface PathTarget {
    checked_url: string;
    old_urls: string[];
    referring_domains: number;
}
export interface PathCheck extends PathTarget {
    final_status: number | null;
    final_url: string | null;
    verdict: RedirectVerdict;
    /** Redirected to the new site's homepage from a deeper path, which search engines treat as a soft 404. */
    home_redirect?: true;
    /** Each redirect followed, in order. */
    hops?: {
        url: string;
        status: number;
    }[];
    error?: string;
}
export declare function verdictFor(status: number, redirected: boolean): RedirectVerdict;
/** A 401, or a redirect that lands on a login page or carries the requested path back as a return param. */
export declare function isGated(checkedUrl: string, finalUrl: string, status: number): boolean;
/** Drops utm_* and click-ID params, leaving the rest of the query as written. */
export declare function stripTracking(search: string): string;
/** Same path and query on `origin`, without tracking params. */
export declare function mapToOrigin(oldUrl: string, origin: string): string;
/** One target per checked URL, in first-seen order. */
export declare function groupByPath(pages: {
    url: string;
    referring_domains: number;
}[], origin: string): PathTarget[];
/** Worst verdict first, then most referring domains. */
export declare function sortWorstFirst(checks: PathCheck[]): PathCheck[];
/** The first value of a Location header, since some proxies join duplicates with ", ". */
export declare function firstLocation(header: string | null): string | null;
export interface BacklinkRedirectsInput {
    domain: string;
    new_origin: string;
    limit?: number;
    refresh?: boolean;
    /** Sent on the path checks only. */
    headers?: Record<string, string>;
    fetchFn?: typeof fetch;
    onProgress?: (message: string) => Promise<void> | void;
}
export interface BacklinkRedirectsResult {
    domain: string;
    new_origin: string;
    total_pages_with_backlinks?: number;
    old_urls: number;
    checked: number;
    summary: Record<RedirectVerdict, number>;
    pages: PathCheck[];
    cost: number;
    cached: boolean;
    fetched_at: string;
}
/** Old domain's linked pages from Backlinks, each distinct path requested on new_origin. */
export declare function backlinkRedirects(client: DataForSeoClient, input: BacklinkRedirectsInput): Promise<BacklinkRedirectsResult>;
