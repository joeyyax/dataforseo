/**
 * How a search term relates to the client: their own name, one of their topics, someone else's
 * name (a navigational search for another brand or place) or unrelated. `unsorted` means no
 * topics were given, so on- and off-topic can't be told apart.
 */
export type TermKind = 'brand' | 'topic' | 'elsewhere' | 'other-name' | 'unrelated' | 'unsorted';
/** US states, large or capital cities and Canada, to spot a search aimed at another area. */
export declare const US_PLACES: string[];
/** A topic label and the words that mark a term as on it. */
export interface Topic {
    label: string;
    words: string[];
}
/** The parsed filter `classify` sorts terms with. Build it with `relevanceFor`. */
export interface Relevance {
    /** Squashed names that mean the client: domain stem, brand, aliases. */
    brand: string[];
    /** Squashed names that mean a competitor. */
    others: string[];
    topics: Topic[];
    /** Places the client serves, lowercased. Empty means no area check. */
    area: string[];
}
/** What `classify` returns. */
export interface Classified {
    kind: TermKind;
    /** The topic label, for `topic` terms. */
    theme?: string;
}
/** Lowercase letters and digits only: `Acme-Plumbing` → `acmeplumbing`. */
export declare function squash(s: string): string;
/** `acme-plumbing.co.uk` → `acmeplumbing`: the label before the public suffix. */
export declare function domainStem(domain: string): string;
/** Keywords naming the domain or brand are navigational and would surface the site itself. */
export declare function isBrandKeyword(keyword: string, stems: string[]): boolean;
/** `"Plumbing: plumber, drain"` → label and words; a bare `"pipes"` is its own label. */
export declare function parseTopics(input: string[] | undefined): Topic[];
/** Whole-word match that also takes a plain plural: "pipe" matches "pipes", not "bagpipe". */
export declare function mentions(keyword: string, word: string): boolean;
/** Builds the relevance filter from the domain, names, competitors, topics and service area. */
export declare function relevanceFor(input: {
    domain: string;
    brand?: string;
    aliases?: string[];
    competitors?: string[];
    topics?: string[];
    area?: string[];
}): Relevance;
/** A US place the term names that isn't part of the client's area, if any. */
export declare function elsewhere(keyword: string, area: string[]): string | undefined;
/** Sorts one search term into a `TermKind`. */
export declare function classify(keyword: string, intent: string | undefined, r: Relevance): Classified;
/** DataForSEO's main intent for a keyword_data object, when it has one. */
export declare function intentOf(keywordData: any): string | undefined;
