import { DailyLimitError, type Charged, type DataForSeoClient } from './client.js';
import { combine, dailyBudget, sameSite, DEFAULT_LANGUAGE, DEFAULT_LOCATION, type Spend } from './checks.js';
import { mapLimit, money, normalizeDomain } from './util.js';

const SERP = '/serp/google/organic';
const LIVE = `${SERP}/live/regular`;

/** Search terms `rankCheck` runs before it refuses. */
export const DEFAULT_RANK_MAX_KEYWORDS = 100;
/** Results read per search: Google's page one. */
export const DEFAULT_RANK_DEPTH = 10;

/** `queue` takes about 5 minutes, `priority` about 1, `live` a few seconds. */
export type RankMode = 'queue' | 'priority' | 'live';

/** USD for the first 10 results of one search. Each further 10 costs 75% of this. */
export const RANK_PRICES: Record<RankMode, number> = { queue: 0.0006, priority: 0.0012, live: 0.002 };

/** The most `rankCheck` could cost for `terms` searches. DataForSEO bills deeper pages only when Google returns them. */
export function estimateRankCost(terms: number, mode: RankMode = 'queue', depth = DEFAULT_RANK_DEPTH): number {
  const pages = Math.ceil(depth / 10);
  return money(terms * RANK_PRICES[mode] * (1 + 0.75 * (pages - 1)));
}

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
  summary: { top_3: number; page_one: number; lower: number; not_found: number };
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
export function parseSerp(result: any, domain: string): Pick<RankTerm, 'position' | 'url' | 'title' | 'features' | 'top_3'> {
  const organic = (Array.isArray(result?.items) ? result.items : []).filter((i: any) => i?.type === 'organic');
  const mine = organic.find((i: any) => sameSite(i.domain ?? i.url, domain));
  const types: string[] = Array.isArray(result?.item_types) ? result.item_types : [];
  return {
    position: mine ? Number(mine.rank_group) : null,
    url: mine?.url ?? null,
    title: mine?.title ?? null,
    features: types.filter((t) => t !== 'organic'),
    top_3: organic.slice(0, 3).map((i: any) => ({ position: Number(i.rank_group), domain: normalizeDomain(String(i.domain ?? i.url ?? '')), url: String(i.url ?? '') })),
  };
}

/** Where a domain ranks on Google today for each search term: one search per term, queued or live. */
export async function rankCheck(
  client: DataForSeoClient,
  input: RankCheckInput,
  now: () => number = Date.now,
): Promise<RankCheckResult> {
  const keywords = [...new Set((input.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean))];
  const max = input.max_keywords ?? DEFAULT_RANK_MAX_KEYWORDS;
  if (keywords.length > max) {
    throw new Error(`${keywords.length} search terms is more than max_keywords (${max}). Each term is a paid search; raise max_keywords to run them all.`);
  }
  if (!keywords.length) throw new Error('Name at least one search term.');
  const depth = input.depth ?? DEFAULT_RANK_DEPTH;
  if (!Number.isInteger(depth) || depth < 10 || depth > 100) throw new Error(`depth is ${depth}; use a whole number from 10 to 100.`);
  const domain = normalizeDomain(input.domain);
  const location = input.location ?? DEFAULT_LOCATION;
  const language = input.language ?? DEFAULT_LANGUAGE;
  const device = input.device ?? 'desktop';
  const mode = input.mode ?? 'queue';
  if (!(mode in RANK_PRICES)) throw new Error(`mode is "${mode}"; use queue, priority or live.`);
  if (mode !== 'live' && !client.queued) throw new Error("This client can't queue tasks. Use mode: 'live', or a client from createDataForSeoClient.");
  const task = (keyword: string) => ({ keyword, location_name: location, language_name: language, device, depth });

  const charges: (Charged | null)[] = input.refresh || !client.cached
    ? keywords.map(() => null)
    : await Promise.all(keywords.map((k) => client.cached!(LIVE, task(k))));
  const misses = keywords.filter((_, i) => !charges[i]);

  if (misses.length) {
    const estimate = estimateRankCost(misses.length, mode, depth);
    const budget = await dailyBudget(client, now);
    if (budget.left !== null && estimate > budget.left) {
      throw new DailyLimitError(null, LIVE, `This check could cost up to $${estimate.toFixed(4)} and $${budget.left.toFixed(4)} of DataForSEO's daily spend limit ($${budget.limit}) is left. It resets at midnight UTC.`);
    }
    const fresh = mode === 'live'
      ? await mapLimit(misses, 3, (k) => client.live(LIVE, task(k), { refresh: true }))
      : await client.queued!(SERP, misses.map(task), { priority: mode === 'priority', pollMs: input.pollMs, timeoutMs: input.timeoutMs });
    let next = 0;
    for (let i = 0; i < charges.length; i++) if (!charges[i]) charges[i] = fresh[next++];
  }

  const terms: RankTerm[] = keywords.map((keyword, i) => {
    const c = charges[i]!;
    return { keyword, ...parseSerp(c.result, domain), cost: c.cost, cached: c.cached, fetched_at: c.fetched_at };
  });
  const found = terms.filter((t) => t.position !== null).map((t) => t.position!);
  return {
    domain, location, language, device, depth, mode, terms,
    summary: {
      top_3: found.filter((p) => p <= 3).length,
      page_one: found.filter((p) => p <= 10).length,
      lower: found.filter((p) => p > 10).length,
      not_found: terms.length - found.length,
    },
    ...combine(charges as Charged[], new Date(now()).toISOString()),
  };
}

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
export function rankDiff(prev: RankCheckResult, next: RankCheckResult): RankDiff {
  if (prev.location !== next.location || prev.language !== next.language || prev.device !== next.device) {
    throw new Error('Compare rank checks with the same location, language and device.');
  }
  const depth = Math.min(prev.depth, next.depth);
  const within = (p: number | null) => (p !== null && p <= depth ? p : null);
  const before = new Map(prev.terms.map((t) => [t.keyword, t]));
  const after = new Set(next.terms.map((t) => t.keyword));
  const diff: RankDiff = { gained: [], lost: [], improved: [], declined: [], unchanged: [], depth, not_compared: [] };

  for (const t of next.terms) {
    const old = before.get(t.keyword);
    if (!old) {
      diff.not_compared.push(t.keyword);
      continue;
    }
    const from = within(old.position);
    const to = within(t.position);
    const move: RankMove = { keyword: t.keyword, from, to, change: from !== null && to !== null ? from - to : null, url: to !== null ? t.url : old.url };
    if (from === null && to !== null) diff.gained.push(move);
    else if (from !== null && to === null) diff.lost.push(move);
    else if (move.change! > 0) diff.improved.push(move);
    else if (move.change! < 0) diff.declined.push(move);
    else diff.unchanged.push(move);
  }
  diff.not_compared.push(...prev.terms.filter((t) => !after.has(t.keyword)).map((t) => t.keyword));

  diff.gained.sort((a, b) => a.to! - b.to!);
  diff.lost.sort((a, b) => a.from! - b.from!);
  diff.improved.sort((a, b) => b.change! - a.change!);
  diff.declined.sort((a, b) => a.change! - b.change!);
  return diff;
}
