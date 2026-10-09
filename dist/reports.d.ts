import { type ReportSpec } from './report.js';
import { type AiResult, type BaselineResult, type ClassifiedKeyword, type GapResult, type LocalResult, type SnapshotResult } from './checks.js';
import type { BacklinkRedirectsResult, PathCheck } from './redirects.js';
/** One definition per term, so every report explains it the same way. */
export declare const GLOSSARY: {
    readonly position: "Where the page shows in Google’s results for that search. #1 is the first result; #1 to #10 is page one.";
    readonly searches: "Average Google searches a month for the term across the United States.";
    readonly visits: "An estimate of clicks from Google: each term’s searches a month times the share of clicks its position usually gets. It isn’t from analytics.";
    readonly pageOne: "Positions #1 to #10, the first page of results. Few people click past it.";
    readonly topThree: "Positions #1 to #3, which get most of the clicks.";
    readonly navigational: "A search for one specific business, brand, venue or event by name.";
    readonly intent: "What the searcher is likely after, as DataForSEO classifies it: an answer, a specific place or site, options to compare or a way to act.";
    readonly mention: "The AI answer names the organization in its text, with or without a link.";
    readonly citation: "The AI answer links a page on the site as one of its sources.";
    readonly linkingSites: "Other websites with at least one link to that address. Each site counts once.";
    readonly mapsTop3: "The three listings Google shows with the map at the top of local results. Most taps go to these.";
    readonly aiSearches: "DataForSEO’s estimate of how often people ask AI tools that question in a month.";
};
/**
 * Terms about the client's work at #4 to #20: page one or two, not yet top 3. One per page, since the fix is the page.
 * Searches for a specific place or site come last; people looking for a service or an answer come first.
 */
export declare function snapshotOpportunities(keywords: ClassifiedKeyword[]): (ClassifiedKeyword & {
    similar: number;
})[];
/** Report for `seoSnapshot`. */
export declare function snapshotReport(r: SnapshotResult, date: string): ReportSpec;
/** Report for `competitorGap`. */
export declare function gapReport(r: GapResult, date: string): ReportSpec;
/** Report for `localVisibility`. */
export declare function localReport(r: LocalResult, date: string): ReportSpec;
/** Report for `aiVisibility`. */
export declare function aiReport(r: AiResult, date: string): ReportSpec;
/** Report for `rankBaseline`: the baseline itself, a same-data notice or the changes since. */
export declare function baselineReport(r: BaselineResult, date: string): ReportSpec;
/** "/a → /b → /c" when a check took two or more redirects, else null. */
export declare function chain(p: PathCheck): string | null;
/** Several old paths landing on one general page, so each lost its specific match. */
export declare function funnels(pages: PathCheck[], min?: number): {
    lands: string;
    from: PathCheck[];
}[];
/** Report for `backlinkRedirects`: a migration check, or a broken link check when the origin is the live site. */
export declare function redirectReport(r: BacklinkRedirectsResult, date: string): ReportSpec;
