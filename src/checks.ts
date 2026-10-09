import type { Charged, DataForSeoClient } from './client.js';
import { mapLimit, money, normalizeDomain } from './util.js';
import { diffSnapshots, snapshotId, snapshotLimit, trimSnapshot, type RankedKeyword, type RankSnapshot, type SnapshotDiff, type SnapshotStore } from './snapshots.js';
import { classify, domainStem, intentOf, isBrandKeyword, relevanceFor, squash, type Relevance, type TermKind, type Topic } from './relevance.js';

/** DataForSEO location name used when none is given. */
export const DEFAULT_LOCATION = 'United States';
/** DataForSEO language name used when none is given. */
export const DEFAULT_LANGUAGE = 'English';
/** Maps results read per search. */
export const MAPS_DEPTH = 20;
/** Snapshot and baseline pull the same 100 terms, so one cached call serves both. */
export const DEFAULT_SNAPSHOT_LIMIT = 100;
/** Terms a ranking baseline tracks. */
export const DEFAULT_BASELINE_LIMIT = 100;
/** Terms pulled per competitor and gap type. */
export const DEFAULT_GAP_LIMIT = 100;
/** A competitor term counts only when the competitor is on page one for it. */
export const GAP_MAX_POSITION = 10;
/** Competitor candidates returned. */
export const DEFAULT_CANDIDATES = 10;
const CANDIDATE_POOL = 30;
/** Search terms competitor discovery compares on. */
export const DISCOVERY_KEYWORDS = 20;
/** Maps searches `localVisibility` runs before it refuses. */
export const DEFAULT_MAX_KEYWORDS = 5;
/** AI prompts pulled by default: none, since that call costs extra. */
export const DEFAULT_PROMPTS = 0;

const LABS = '/dataforseo_labs/google';
const LLM = '/ai_optimization/llm_mentions';
/** LLM Mentions calls can take up to 120 seconds. */
const LLM_TIMEOUT_MS = 130_000;

/** What a check cost and how fresh its data is. */
export interface Spend {
  cost: number;
  cached: boolean;
  fetched_at: string;
}

/** Several calls as one: total cost, cached only when all were and the oldest `fetched_at`. */
export function combine(charges: Charged[], nowIso: string): Spend {
  if (!charges.length) return { cost: 0, cached: false, fetched_at: nowIso };
  return {
    cost: money(charges.reduce((sum, c) => sum + c.cost, 0)),
    cached: charges.every((c) => c.cached),
    fetched_at: charges.map((c) => c.fetched_at).sort()[0],
  };
}

/** Same site: exact domain or a subdomain of it. */
export function sameSite(candidate: string | null | undefined, domain: string): boolean {
  if (!candidate) return false;
  const host = normalizeDomain(candidate);
  return host === domain || host.endsWith(`.${domain}`);
}

function itemsOf(result: any): any[] {
  return Array.isArray(result?.items) ? result.items : [];
}

// Balance

/** Today's date and USD spend from user_data's `money.statistics.day`. */
export function daySpend(day: any): { date?: string; total?: number } | undefined {
  if (!day || typeof day !== 'object') return undefined;
  return { date: day.value, total: typeof day.total === 'number' ? day.total : undefined };
}

/** Account balance and spend from `balance`. Amounts are USD. */
export interface Balance {
  login?: string;
  balance?: number;
  deposited?: number;
  spent?: number;
  today?: { date?: string; total?: number };
  cost: number;
  cached: boolean;
}

/** Account balance, total deposits and spend, from the free user_data call. */
export async function balance(client: DataForSeoClient): Promise<Balance> {
  const res = await client.userData();
  const m = res.result?.money ?? {};
  return {
    login: res.result?.login,
    balance: m.balance,
    deposited: m.total,
    spent: typeof m.total === 'number' && typeof m.balance === 'number' ? money(m.total - m.balance) : undefined,
    today: daySpend(m.statistics?.day),
    cost: res.cost,
    cached: false,
  };
}

/** Today's spend against the account's daily limit, from the free user_data call. `limit` is null when none is set. */
export interface DailyBudget {
  date: string;
  spent: number;
  limit: number | null;
  left: number | null;
}

/** Today's spend against the daily limit. Free. */
export async function dailyBudget(client: DataForSeoClient, now: () => number = Date.now): Promise<DailyBudget> {
  const res = await client.userData();
  const m = res.result?.money ?? {};
  const date = new Date(now()).toISOString().slice(0, 10);
  const today = daySpend(m.statistics?.day);
  const spent = today?.date === date && typeof today.total === 'number' ? today.total : 0;
  const cap = Number(m.limits?.day?.total);
  const limit = Number.isFinite(cap) && cap > 0 ? cap : null;
  return { date, spent: money(spent), limit, left: limit === null ? null : money(Math.max(0, limit - spent)) };
}

// Ranked keywords

/** Ranking terms per position band. */
export interface Positions {
  top_3: number;
  '4_10': number;
  '11_20': number;
  '21_100': number;
}

/** One ranked_keywords item as a `RankedKeyword`, or null when it has no keyword or result. */
export function parseRankedItem(item: any): RankedKeyword | null {
  const keyword = item?.keyword_data?.keyword;
  const serp = item?.ranked_serp_element?.serp_item;
  if (typeof keyword !== 'string' || !serp) return null;
  return {
    keyword,
    position: Number(serp.rank_group ?? 0),
    search_volume: Number(item.keyword_data.keyword_info?.search_volume ?? 0),
    etv: Number(serp.etv ?? 0),
    url: serp.relative_url ?? serp.url ?? '',
    ...(intentOf(item.keyword_data) ? { intent: intentOf(item.keyword_data) } : {}),
  };
}

interface RankedPull {
  charge: Charged;
  total_keywords: number;
  etv: number;
  positions: Positions;
  keywords: RankedKeyword[];
}

async function pullRanked(
  client: DataForSeoClient,
  opts: { domain: string; location: string; language: string; limit: number; refresh?: boolean },
): Promise<RankedPull> {
  const charge = await client.live(`${LABS}/ranked_keywords/live`, {
    target: opts.domain,
    location_name: opts.location,
    language_name: opts.language,
    item_types: ['organic'],
    limit: opts.limit,
    order_by: ['ranked_serp_element.serp_item.etv,desc'],
  }, { refresh: opts.refresh });
  const r = charge.result ?? {};
  const o = r.metrics?.organic ?? {};
  const n = (k: string) => Number(o[k] ?? 0);
  return {
    charge,
    total_keywords: Number(r.total_count ?? o.count ?? 0),
    etv: Math.round(n('etv')),
    positions: {
      top_3: n('pos_1') + n('pos_2_3'),
      '4_10': n('pos_4_10'),
      '11_20': n('pos_11_20'),
      '21_100': ['21_30', '31_40', '41_50', '51_60', '61_70', '71_80', '81_90', '91_100'].reduce((s, k) => s + n(`pos_${k}`), 0),
    },
    keywords: itemsOf(r).map(parseRankedItem).filter((k): k is RankedKeyword => k !== null),
  };
}

/** Pages among the pulled keywords, most estimated visits first. */
export function topPages(keywords: RankedKeyword[]): { url: string; keywords: number; etv: number }[] {
  const pages = new Map<string, { url: string; keywords: number; etv: number }>();
  for (const k of keywords) {
    const page = pages.get(k.url) ?? { url: k.url, keywords: 0, etv: 0 };
    page.keywords++;
    page.etv += k.etv;
    pages.set(k.url, page);
  }
  return [...pages.values()].map((p) => ({ ...p, etv: Math.round(p.etv) })).sort((a, b) => b.etv - a.etv);
}

/** Where to search and whether to skip the cache. */
export interface Market {
  /** DataForSEO location name. Default: `DEFAULT_LOCATION`. */
  location?: string;
  /** DataForSEO language name. Default: `DEFAULT_LANGUAGE`. */
  language?: string;
  /** Pay for fresh data instead of using the cache. */
  refresh?: boolean;
}

// Snapshot

/** A ranking term with its `TermKind` and topic. */
export type ClassifiedKeyword = RankedKeyword & { kind: TermKind; theme?: string };

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
  top_pages: { url: string; keywords: number; etv: number }[];
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

function relevanceInput(args: RelevanceOptions, r: Relevance): RelevanceInput {
  return { ...(args.brand?.trim() ? { brand: args.brand.trim() } : {}), aliases: (args.aliases ?? []).map((a) => a.trim()).filter(Boolean), topics: r.topics, area: r.area };
}

/** A domain's Google rankings, estimated visits and top pages: one Labs call. */
export async function seoSnapshot(
  client: DataForSeoClient,
  input: SnapshotInput,
  now: () => number = Date.now,
): Promise<SnapshotResult> {
  const domain = normalizeDomain(input.domain);
  const location = input.location ?? DEFAULT_LOCATION;
  const language = input.language ?? DEFAULT_LANGUAGE;
  const pull = await pullRanked(client, { domain, location, language, limit: input.limit ?? DEFAULT_SNAPSHOT_LIMIT, refresh: input.refresh });
  const r = relevanceFor({ domain, brand: input.brand, aliases: input.aliases, competitors: input.competitors, topics: input.topics, area: input.area });
  return {
    domain, location, language,
    est_monthly_visits: pull.etv,
    keywords_total: pull.total_keywords,
    positions: pull.positions,
    relevance: relevanceInput(input, r),
    top_keywords: pull.keywords.map((k) => ({ ...k, ...classify(k.keyword, k.intent, r) })),
    top_pages: topPages(pull.keywords),
    ...combine([pull.charge], new Date(now()).toISOString()),
  };
}

// Competitor gap

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
  competitors: { domain: string; position: number; url: string }[];
}

/** One domain_intersection result, as `mergeGaps` takes it. */
export interface GapPull {
  domain: string;
  /** `true` for terms both rank for, `false` for terms only the competitor ranks for. */
  shared: boolean;
  items: any[];
}

/** One term per keyword across competitors, kept when a competitor is on page one and ahead. */
export function mergeGaps(pulls: GapPull[], r: Relevance): GapTerm[] {
  const terms = new Map<string, GapTerm>();
  for (const { domain, shared, items } of pulls) {
    for (const item of items) {
      const keyword = item?.keyword_data?.keyword;
      const theirs = item?.first_domain_serp_element;
      const ours = shared ? item?.second_domain_serp_element : null;
      if (typeof keyword !== 'string' || !theirs) continue;
      const position = Number(theirs.rank_group ?? 0);
      const mine = ours ? Number(ours.rank_group ?? 0) : null;
      if (!position || position > GAP_MAX_POSITION || (mine !== null && mine > 0 && mine <= position)) continue;
      const intent = intentOf(item.keyword_data);
      const term: GapTerm = terms.get(keyword) ?? {
        keyword,
        search_volume: Number(item.keyword_data.keyword_info?.search_volume ?? 0),
        ...(intent ? { intent } : {}),
        gap: mine ? 'weak' : 'missing',
        ...classify(keyword, intent, r),
        position: mine || null,
        url: ours ? (ours.relative_url ?? ours.url ?? null) : null,
        competitors: [],
      };
      if (!term.competitors.some((c) => c.domain === domain)) {
        term.competitors.push({ domain, position, url: theirs.relative_url ?? theirs.url ?? '' });
        term.competitors.sort((a, b) => a.position - b.position);
      }
      terms.set(keyword, term);
    }
  }
  return [...terms.values()].sort((a, b) => b.search_volume - a.search_volume || b.competitors.length - a.competitors.length);
}

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
  excluded: { brand: number; other_name: number; elsewhere: number; unrelated: number; ahead: number };
  /** A few left-out terms per reason, so a reader can check the filter. */
  excluded_examples: { other_name: string[]; elsewhere: string[]; unrelated: string[] };
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
export async function competitorGap(
  client: DataForSeoClient,
  input: GapInput,
  now: () => number = Date.now,
): Promise<GapResult> {
  const domain = normalizeDomain(input.domain);
  const location = input.location ?? DEFAULT_LOCATION;
  const language = input.language ?? DEFAULT_LANGUAGE;
  const limit = input.limit ?? DEFAULT_GAP_LIMIT;
  const charges: Charged[] = [];
  const competitors = [...new Set((input.competitors ?? []).map(normalizeDomain))].filter((d) => d && d !== domain);
  if (!competitors.length) throw new Error('Name at least one competitor other than the domain itself.');
  const r = relevanceFor({ domain, brand: input.brand, aliases: input.aliases, competitors, topics: input.topics, area: input.area });

  const jobs = competitors.flatMap((competitor) => [false, true].map((shared) => ({ competitor, shared })));
  const pulls = await mapLimit(jobs, 3, async ({ competitor, shared }) => {
    const res = await client.live(`${LABS}/domain_intersection/live`, {
      target1: competitor,
      target2: domain,
      intersections: shared,
      item_types: ['organic'],
      location_name: location,
      language_name: language,
      limit,
      filters: [['first_domain_serp_element.rank_group', '<=', GAP_MAX_POSITION]],
      order_by: ['keyword_data.keyword_info.search_volume,desc'],
    }, { refresh: input.refresh });
    charges.push(res);
    const items = itemsOf(res.result);
    return { domain: competitor, shared, items, total: Number(res.result?.total_count ?? items.length) };
  });

  const all = mergeGaps(pulls, r);
  const sharedCount = new Set(pulls.filter((p) => p.shared).flatMap((p) => p.items.map((i) => i?.keyword_data?.keyword)));
  const gaps = all.filter((g) => g.kind === 'topic' || g.kind === 'unsorted');
  const left = (kind: TermKind) => all.filter((g) => g.kind === kind);
  return {
    domain, location, language, limit,
    max_position: GAP_MAX_POSITION,
    relevance: relevanceInput(input, r),
    competitors: competitors.map((d) => {
      const mine = pulls.filter((p) => p.domain === d);
      return {
        domain: d,
        missing_total: mine.find((p) => !p.shared)?.total ?? 0,
        shared_total: mine.find((p) => p.shared)?.total ?? 0,
        checked: Math.max(0, ...mine.map((p) => p.items.length)),
      };
    }),
    gaps,
    excluded: {
      brand: left('brand').length,
      other_name: left('other-name').length,
      elsewhere: left('elsewhere').length,
      unrelated: left('unrelated').length,
      ahead: [...sharedCount].filter((k) => !all.some((g) => g.keyword === k)).length,
    },
    excluded_examples: {
      other_name: left('other-name').slice(0, 5).map((g) => g.keyword),
      elsewhere: left('elsewhere').slice(0, 5).map((g) => g.keyword),
      unrelated: left('unrelated').slice(0, 5).map((g) => g.keyword),
    },
    gap_terms: gaps.length,
    gap_search_volume: gaps.reduce((s, g) => s + g.search_volume, 0),
    ...combine(charges, new Date(now()).toISOString()),
  };
}

/** Directories, social networks and reference sites that share rankings with everyone. */
const NOISE_DOMAINS = [
  'yelp.com', 'angi.com', 'angieslist.com', 'homeadvisor.com', 'thumbtack.com', 'houzz.com', 'porch.com', 'bbb.org',
  'yellowpages.com', 'superpages.com', 'manta.com', 'mapquest.com', 'nextdoor.com', 'tripadvisor.com', 'expedia.com',
  'groupon.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com', 'zillow.com', 'realtor.com', 'trulia.com',
  'wikipedia.org', 'wikihow.com', 'britannica.com', 'quora.com', 'medium.com', 'reddit.com', 'facebook.com',
  'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com', 'pinterest.com', 'youtube.com',
  'google.com', 'apple.com', 'amazon.com', 'ebay.com', 'walmart.com', 'etsy.com', 'craigslist.org', 'eventbrite.com',
  'patch.com', 'nytimes.com', 'usnews.com', 'forbes.com', 'webmd.com', 'healthline.com', 'mayoclinic.org',
];

const NOISE_TLD = /\.(gov|edu|mil|int)(\.[a-z]{2})?$|\.(k12|gov|state)\.[a-z]{2}\.us$/;

/** True for directories, social sites, reference sites and public bodies. */
export function isNoiseCompetitor(domain: string): boolean {
  return NOISE_TLD.test(domain) || NOISE_DOMAINS.some((n) => sameSite(domain, n));
}

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
export async function competitorCandidates(
  client: DataForSeoClient,
  input: CandidatesInput,
  now: () => number = Date.now,
): Promise<CandidatesResult> {
  const domain = normalizeDomain(input.domain);
  const location = input.location ?? DEFAULT_LOCATION;
  const language = input.language ?? DEFAULT_LANGUAGE;
  const charges: Charged[] = [];

  let source: CandidatesResult['keywords_source'] = 'given';
  let used: DiscoveryKeyword[] = [...new Set((input.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean))]
    .slice(0, DISCOVERY_KEYWORDS)
    .map((keyword) => ({ keyword, search_volume: 0 }));
  if (!used.length) {
    source = 'rankings';
    const pull = await pullRanked(client, { domain, location, language, limit: DEFAULT_SNAPSHOT_LIMIT, refresh: input.refresh });
    charges.push(pull.charge);
    const stems = [domainStem(domain), ...(input.brand ? [squash(input.brand)] : [])];
    used = pull.keywords
      .filter((k) => k.search_volume > 0 && !isBrandKeyword(k.keyword, stems))
      .slice(0, DISCOVERY_KEYWORDS)
      .map((k) => ({ keyword: k.keyword, search_volume: k.search_volume, position: k.position }));
  }

  const base = { domain, location, language, keywords_source: source, keywords_used: used };
  if (!used.length) {
    return {
      ...base,
      candidates: [],
      filtered_out: [],
      note: 'No non-brand search terms to compare on. Call again with keywords naming what customers search for.',
      ...combine(charges, new Date(now()).toISOString()),
    };
  }

  const res = await client.live(`${LABS}/serp_competitors/live`, {
    keywords: used.map((k) => k.keyword),
    location_name: location,
    language_name: language,
    item_types: ['organic'],
    limit: CANDIDATE_POOL,
    order_by: ['keywords_count,desc', 'avg_position,asc'],
  }, { refresh: input.refresh });
  charges.push(res);

  const filtered_out: string[] = [];
  const candidates: CompetitorCandidate[] = [];
  for (const item of itemsOf(res.result)) {
    const d = normalizeDomain(String(item?.domain ?? ''));
    if (!d || sameSite(d, domain) || sameSite(domain, d)) continue;
    if (isNoiseCompetitor(d)) {
      filtered_out.push(d);
      continue;
    }
    candidates.push({
      domain: d,
      keywords_matched: Number(item?.keywords_count ?? 0),
      avg_position: Math.round(Number(item?.avg_position ?? 0) * 10) / 10,
      etv: Math.round(Number(item?.etv ?? 0)),
    });
  }
  candidates.sort((a, b) => b.keywords_matched - a.keywords_matched || a.avg_position - b.avg_position);
  return {
    ...base,
    candidates: candidates.slice(0, input.limit ?? DEFAULT_CANDIDATES),
    filtered_out,
    note: 'Pick the real competitors and pass them to competitorGap.',
    ...combine(charges, new Date(now()).toISOString()),
  };
}

// Local visibility

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
export function parseMapsItems(result: any): MapsListing[] {
  return itemsOf(result).filter((i) => i?.type === 'maps_search').map((i) => ({
    position: Number(i.rank_group ?? 0),
    title: String(i.title ?? ''),
    domain: i.domain ?? null,
    rating: typeof i.rating?.value === 'number' ? i.rating.value : null,
    reviews: typeof i.rating?.votes_count === 'number' ? i.rating.votes_count : null,
    category: i.category ?? null,
    url: typeof i.url === 'string' ? i.url : null,
    maps_url: i.cid ? `https://www.google.com/maps?cid=${encodeURIComponent(String(i.cid))}` : null,
  }));
}

function normName(s: string): string {
  return s.toLowerCase().replace(/&/g, ' and ').replace(/\b(the|llc|inc|co|company|ltd)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
}

/** By website domain first, then by business name either way round. */
export function matchesBusiness(listing: MapsListing, business: string, domain?: string): boolean {
  if (domain && sameSite(listing.domain, domain)) return true;
  const want = normName(business);
  const got = normName(listing.title);
  if (want.length < 3 || got.length < 3) return false;
  return got.includes(want) || want.includes(got);
}

const COORDINATE_RE = /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?(,\s*\d+(\.\d+)?z?)?$/;

/** What `localVisibility` returns. */
export interface LocalResult extends Spend {
  business: string;
  domain?: string;
  location: string;
  language: string;
  results: { keyword: string; position: number | null; listing: MapsListing | null; top_3: MapsListing[] }[];
  summary: { top_3: number; lower: number; not_found: number };
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
export async function localVisibility(
  client: DataForSeoClient,
  input: LocalInput,
  now: () => number = Date.now,
): Promise<LocalResult> {
  const keywords = [...new Set((input.keywords ?? []).map((k) => k.trim()).filter(Boolean))];
  const max = input.max_keywords ?? DEFAULT_MAX_KEYWORDS;
  if (keywords.length > max) {
    throw new Error(`${keywords.length} search terms is more than max_keywords (${max}). Each term is a paid call; raise max_keywords to run them all.`);
  }
  const domain = input.domain
    ? normalizeDomain(input.domain)
    : /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(input.business) ? normalizeDomain(input.business) : undefined;
  const language = input.language ?? DEFAULT_LANGUAGE;
  const where = COORDINATE_RE.test(input.location.trim())
    ? { location_coordinate: input.location.replace(/\s+/g, '') }
    : { location_name: input.location };

  const checks = await mapLimit(keywords, 3, async (keyword) => {
    const charge = await client.live('/serp/google/maps/live/advanced', { keyword, ...where, language_name: language, depth: MAPS_DEPTH }, { refresh: input.refresh });
    const listings = parseMapsItems(charge.result);
    const mine = listings.find((l) => matchesBusiness(l, input.business, domain)) ?? null;
    return { keyword, position: mine?.position ?? null, listing: mine, top_3: listings.slice(0, 3), charge };
  });

  const results = checks.map(({ charge: _charge, ...rest }) => rest);
  return {
    business: input.business, domain, location: input.location, language,
    results,
    summary: {
      top_3: results.filter((r) => r.position !== null && r.position <= 3).length,
      lower: results.filter((r) => r.position !== null && r.position > 3).length,
      not_found: results.filter((r) => r.position === null).length,
    },
    ...combine(checks.map((c) => c.charge), new Date(now()).toISOString()),
  };
}

// AI visibility

/** Answer counts, total and per AI platform. */
export interface MentionCounts {
  total: number;
  by_platform: Record<string, number>;
}

function countPlatforms(groups: any): MentionCounts {
  const by: Record<string, number> = {};
  for (const g of Array.isArray(groups) ? groups : []) {
    const key = String(g?.platform ?? g?.key ?? 'unknown');
    by[key] = (by[key] ?? 0) + Number(g?.metrics?.mentions ?? g?.mentions ?? 0);
  }
  return { total: Object.values(by).reduce((s, n) => s + n, 0), by_platform: by };
}

/** AI answers to questions containing one topic, and the sites they cite most. */
export interface AiTopic {
  keyword: string;
  mentions: number;
  cited: boolean;
  top_sources: { domain: string; mentions: number }[];
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
export async function aiVisibility(
  client: DataForSeoClient,
  input: AiInput,
  now: () => number = Date.now,
): Promise<AiResult> {
  const domain = normalizeDomain(input.domain);
  const brand = input.brand?.trim() || undefined;
  const topics = (input.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const promptLimit = input.prompts ?? DEFAULT_PROMPTS;
  const scope = { location_code: 2840, language_code: 'en' };
  const call = { refresh: input.refresh, timeoutMs: LLM_TIMEOUT_MS };
  const cited = { domain, search_scope: ['sources'], include_subdomains: true };
  const charges: Charged[] = [];

  const targets = [
    { key: 'cited', target: [cited] },
    ...(brand ? [{ key: 'brand', target: [{ keyword: brand, search_scope: ['answer'] }] }] : []),
    ...topics.map((t) => ({ key: `topic:${t}`, target: [{ keyword: t, search_scope: ['question'] }] })),
  ];

  let citations: MentionCounts;
  let brandMentions: MentionCounts | undefined;
  const topicResults: AiTopic[] = [];
  if (targets.length === 1) {
    const res = await client.live(`${LLM}/target_metrics_lite/live`, { target: [cited], ...scope }, call);
    charges.push(res);
    citations = countPlatforms(res.result?.items);
  } else {
    const res = await client.live(`${LLM}/multi_target_metrics/live`, { targets, ...scope }, call);
    charges.push(res);
    const byKey = new Map(itemsOf(res.result).map((i) => [String(i?.key), i]));
    citations = countPlatforms(byKey.get('cited')?.platform);
    if (brand) brandMentions = countPlatforms(byKey.get('brand')?.platform);
    for (const t of topics) {
      const item = byKey.get(`topic:${t}`);
      const sources = (Array.isArray(item?.sources_domain) ? item.sources_domain : [])
        .map((s: any) => ({ domain: normalizeDomain(String(s?.key ?? '')), mentions: Number(s?.mentions ?? 0) }));
      topicResults.push({
        keyword: t,
        mentions: countPlatforms(item?.platform).total,
        cited: sources.some((s: { domain: string }) => sameSite(s.domain, domain)),
        top_sources: sources.slice(0, 5),
      });
    }
  }

  let prompts: AiPrompt[] = [];
  if (promptLimit > 0) {
    const res = await client.live(`${LLM}/search_mentions/live`, {
      target: [cited], ...scope, limit: promptLimit, order_by: ['ai_search_volume,desc'],
    }, call);
    charges.push(res);
    prompts = itemsOf(res.result).map((i) => ({
      question: String(i?.question ?? ''),
      platform: String(i?.platform ?? ''),
      ai_search_volume: Number(i?.ai_search_volume ?? 0),
      url: (Array.isArray(i?.sources) ? i.sources : []).find((s: any) => sameSite(s?.domain ?? s?.url, domain))?.url ?? null,
    }));
  }

  return {
    domain, brand, citations, brand_mentions: brandMentions, topics: topicResults, top_prompts: prompts,
    ...combine(charges, new Date(now()).toISOString()),
  };
}

// Rank baseline

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
  compared_to: { id: string; created: string; fetched_at: string; keywords_tracked: number; same_data: boolean; compared_terms: number; trimmed: boolean } | null;
  diff: SnapshotDiff | null;
}

/** Latest earlier snapshot for the same market, preferring one that held at least `limit` terms. */
function latestComparable(all: RankSnapshot[], cur: RankSnapshot, limit: number): RankSnapshot | undefined {
  const earlier = all.filter((s) => s.location === cur.location && s.language === cur.language && s.created < cur.created && s.id !== cur.id);
  return earlier.filter((s) => snapshotLimit(s) >= limit).at(-1) ?? earlier.at(-1);
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
export async function rankBaseline(
  client: DataForSeoClient,
  snapshots: SnapshotStore,
  input: BaselineInput,
  now: () => number = Date.now,
): Promise<BaselineResult> {
  const domain = normalizeDomain(input.domain);
  const location = input.location ?? DEFAULT_LOCATION;
  const language = input.language ?? DEFAULT_LANGUAGE;
  const limit = input.limit ?? DEFAULT_BASELINE_LIMIT;
  const pull = await pullRanked(client, { domain, location, language, limit, refresh: input.refresh });

  const created = new Date(now()).toISOString();
  const snapshot: RankSnapshot = {
    id: snapshotId(created, input.label),
    domain,
    ...(input.label ? { label: input.label } : {}),
    location,
    language,
    created,
    limit,
    fetched_at: pull.charge.fetched_at,
    total_keywords: pull.total_keywords,
    etv: pull.etv,
    keywords: pull.keywords,
  };

  const prior = input.compare_to
    ? await snapshots.get(domain, input.compare_to)
    : latestComparable(await snapshots.list(domain), snapshot, limit);
  await snapshots.save(snapshot);

  const compared = prior ? Math.min(snapshotLimit(prior), limit) : limit;
  const trimmed = !!prior && (prior.keywords.length > compared || snapshot.keywords.length > compared);
  const sameData = !!prior && (prior.fetched_at === snapshot.fetched_at
    || (snapshotLimit(prior) !== limit && prior.fetched_at.slice(0, 10) === snapshot.fetched_at.slice(0, 10)));

  return {
    snapshot_id: snapshot.id,
    domain, location, language, limit,
    keywords_tracked: snapshot.keywords.length,
    keywords_total: snapshot.total_keywords,
    est_monthly_visits: snapshot.etv,
    positions: pull.positions,
    keywords: snapshot.keywords,
    compared_to: prior
      ? { id: prior.id, created: prior.created, fetched_at: prior.fetched_at, keywords_tracked: prior.keywords.length, same_data: sameData, compared_terms: compared, trimmed }
      : null,
    diff: prior ? diffSnapshots(trimSnapshot(prior, compared), trimSnapshot(snapshot, compared)) : null,
    ...combine([pull.charge], created),
  };
}
