import { normalizeDomain } from './util.js';

/**
 * How a search term relates to the client: their own name, one of their topics, someone else's
 * name (a navigational search for another brand or place) or unrelated. `unsorted` means no
 * topics were given, so on- and off-topic can't be told apart.
 */
export type TermKind = 'brand' | 'topic' | 'elsewhere' | 'other-name' | 'unrelated' | 'unsorted';

/** US states, large or capital cities and Canada, to spot a search aimed at another area. */
export const US_PLACES = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho',
  'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
  'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina',
  'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas',
  'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming',
  'nyc', 'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia', 'san antonio', 'san diego', 'dallas', 'san jose', 'austin',
  'jacksonville', 'fort worth', 'columbus', 'charlotte', 'indianapolis', 'san francisco', 'seattle', 'denver', 'nashville', 'oklahoma city',
  'el paso', 'boston', 'portland', 'las vegas', 'detroit', 'memphis', 'louisville', 'baltimore', 'milwaukee', 'albuquerque', 'tucson',
  'fresno', 'sacramento', 'kansas city', 'atlanta', 'omaha', 'colorado springs', 'raleigh', 'long beach', 'virginia beach',
  'miami', 'oakland', 'minneapolis', 'tulsa', 'bakersfield', 'wichita', 'tampa', 'new orleans', 'cleveland', 'honolulu',
  'pittsburgh', 'cincinnati', 'st louis', 'orlando', 'spokane', 'boise', 'salem', 'eugene', 'tacoma', 'reno', 'salt lake city',
  'anchorage', 'richmond', 'birmingham', 'rochester', 'des moines', 'chattanooga', 'knoxville', 'savannah',
  'canada', 'british columbia', 'bc',
];

export interface Topic {
  label: string;
  words: string[];
}

export interface Relevance {
  /** Squashed names that mean the client: domain stem, brand, aliases. */
  brand: string[];
  /** Squashed names that mean a competitor. */
  others: string[];
  topics: Topic[];
  /** Places the client serves, lowercased. Empty means no area check. */
  area: string[];
}

export interface Classified {
  kind: TermKind;
  /** The topic label, for `topic` terms. */
  theme?: string;
}

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'ltd', 'plc']);

export function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** `acme-plumbing.co.uk` → `acmeplumbing`: the label before the public suffix. */
export function domainStem(domain: string): string {
  const labels = normalizeDomain(domain).split('.');
  const twoPart = labels.length > 2 && labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels.at(-2)!);
  const suffix = twoPart ? 2 : 1;
  return squash(labels[Math.max(0, labels.length - suffix - 1)] ?? '');
}

/** Keywords naming the domain or brand are navigational and would surface the site itself. */
export function isBrandKeyword(keyword: string, stems: string[]): boolean {
  const k = squash(keyword);
  return stems.some((s) => s.length >= 3 && k.includes(s));
}

/** `"Plumbing: plumber, drain"` → label and words; a bare `"pipes"` is its own label. */
export function parseTopics(input: string[] | undefined): Topic[] {
  return (input ?? []).map((t) => t.trim()).filter(Boolean).map((t) => {
    const i = t.indexOf(':');
    const label = (i === -1 ? t : t.slice(0, i)).trim();
    const words = (i === -1 ? t : t.slice(i + 1)).split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
    return { label, words: words.length ? words : [label.toLowerCase()] };
  }).filter((t) => t.label);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word match that also takes a plain plural: "pipe" matches "pipes", not "bagpipe". */
export function mentions(keyword: string, word: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escape(word)}(s|es)?($|[^a-z0-9])`, 'i').test(keyword);
}

export function relevanceFor(input: { domain: string; brand?: string; aliases?: string[]; competitors?: string[]; topics?: string[]; area?: string[] }): Relevance {
  return {
    brand: [domainStem(input.domain), ...[input.brand, ...(input.aliases ?? [])].filter((s): s is string => !!s?.trim()).map(squash)],
    others: (input.competitors ?? []).map(domainStem),
    topics: parseTopics(input.topics),
    area: (input.area ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean),
  };
}

/** A US place the term names that isn't part of the client's area, if any. */
export function elsewhere(keyword: string, area: string[]): string | undefined {
  if (!area.length) return undefined;
  const k = keyword.toLowerCase();
  return US_PLACES.find((p) => mentions(k, p) && !area.some((a) => a.includes(p) || p.includes(a)));
}

export function classify(keyword: string, intent: string | undefined, r: Relevance): Classified {
  // Another area wins over a name: "acme plumbing vancouver bc" is a search for somewhere else.
  if (elsewhere(keyword, r.area)) return { kind: 'elsewhere' };
  if (isBrandKeyword(keyword, r.brand)) return { kind: 'brand' };
  if (isBrandKeyword(keyword, r.others)) return { kind: 'other-name' };
  const topic = r.topics.find((t) => t.words.some((w) => mentions(keyword, w)));
  if (topic) return { kind: 'topic', theme: topic.label };
  if (intent === 'navigational') return { kind: 'other-name' };
  return { kind: r.topics.length ? 'unrelated' : 'unsorted' };
}

/** DataForSEO's main intent for a keyword_data object, when it has one. */
export function intentOf(keywordData: any): string | undefined {
  const intent = keywordData?.search_intent_info?.main_intent;
  return typeof intent === 'string' ? intent : undefined;
}
