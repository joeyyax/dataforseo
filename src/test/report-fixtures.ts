// Sample check results for the report tests. Invented data on example domains.
import type { AiResult, BacklinkRedirectsResult, BaselineResult, GapResult, LocalResult, RankCheckResult, RankTerm, ReportSpec, SnapshotResult } from '../index.js';
import { aiReport, baselineReport, classify, gapReport, localReport, rankReport, redirectReport, relevanceFor, snapshotReport } from '../index.js';

const spend = { cost: 0.0144, cached: false, fetched_at: '2026-10-08T12:00:00.000Z' };
const kw = (keyword: string, position: number, search_volume: number, etv: number, url: string, intent?: string) =>
  ({ keyword, position, search_volume, etv, url, ...(intent ? { intent } : {}) });

export const plumbingTopics = ['Plumbing: plumber, plumbing, pipe, repipe, leak, drain, sewer, toilet', 'Water heaters: water heater', 'Pumps: sump pump, disposal'];
const relevance = relevanceFor({ domain: 'acmeplumbing.example', brand: 'Acme Plumbing', competitors: ['rivalplumbing.example', 'citydrains.example'], topics: plumbingTopics });
const listing = (position: number, title: string, rating: number | null = 4.6, reviews: number | null = 120) =>
  ({ position, title, domain: null, rating, reviews, category: 'Plumber' });

const keywords = [
  kw('plumber springfield', 2, 2400, 500, '/'),
  kw('emergency plumber', 8, 3600, 90, '/'),
  kw('water heater repair', 6, 1900, 120, '/water-heaters'),
  kw('drain cleaning', 14, 880, 20, '/drains'),
  kw('sewer line repair springfield', 3, 590, 140, '/sewer'),
  kw('tankless water heater install', 11, 480, 12, '/water-heaters/tankless'),
  kw('garbage disposal repair', 5, 320, 30, '/disposals'),
  kw('leak detection', 19, 260, 3, '/leaks'),
  kw('toilet repair', 1, 210, 60, '/toilets'),
  kw('sump pump', 24, 170, 1, '/sump-pumps'),
  kw('repipe house cost', 9, 140, 6, '/blog/repipe-cost-guide-for-older-homes'),
  kw('frozen pipes', 32, 90, 0, '/blog/frozen-pipes'),
  kw('acme plumbing reviews', 1, 90, 40, '/reviews'),
  kw('riverside coffee', 4, 1300, 70, '/blog/2023/03/riverside-coffee-opens/', 'navigational'),
  kw('best podcasts 2026', 18, 900, 5, '/blog/podcasts', 'informational'),
];

export const snapshotFixture: SnapshotResult = {
  domain: 'acmeplumbing.example', location: 'United States', language: 'English',
  est_monthly_visits: 1241, keywords_total: 312,
  positions: { top_3: 18, '4_10': 40, '11_20': 50, '21_100': 34 },
  relevance: { brand: 'Acme Plumbing', aliases: [], topics: relevance.topics, area: [] },
  top_keywords: keywords.map((k) => ({ ...k, ...classify(k.keyword, k.intent, relevance) })),
  top_pages: [
    { url: '/', keywords: 2, etv: 590 },
    { url: '/sewer', keywords: 1, etv: 140 },
    { url: '/water-heaters', keywords: 1, etv: 120 },
  ],
  ...spend,
};

const gap = (keyword: string, search_volume: number, competitors: [string, number][], you: number | null = null) => ({
  keyword, search_volume, gap: you ? 'weak' as const : 'missing' as const, ...classify(keyword, undefined, relevance),
  position: you, url: you ? '/services' : null,
  competitors: competitors.map(([domain, position]) => ({ domain, position, url: '/' })),
});

export const gapFixture: GapResult = {
  domain: 'acmeplumbing.example', location: 'United States', language: 'English', limit: 100, max_position: 10,
  relevance: { brand: 'Acme Plumbing', aliases: [], topics: relevance.topics, area: [] },
  competitors: [{ domain: 'rivalplumbing.example', missing_total: 140, shared_total: 60, checked: 100 }, { domain: 'citydrains.example', missing_total: 38, shared_total: 12, checked: 38 }],
  gaps: [
    gap('tankless water heater', 5000, [['rivalplumbing.example', 3]], 14),
    gap('hydro jetting drain', 1300, [['citydrains.example', 2], ['rivalplumbing.example', 9]]),
    gap('sump pump installation', 900, [['rivalplumbing.example', 7]]),
    gap('water heater install', 720, [['rivalplumbing.example', 4]], 8),
    gap('sewer backflow testing springfield', 480, [['citydrains.example', 1]]),
    gap('slab leak repair', 390, [['rivalplumbing.example', 6]]),
  ],
  excluded: { brand: 0, other_name: 3, elsewhere: 0, unrelated: 12, ahead: 4 },
  excluded_examples: { other_name: ['rival plumbing coupons'], elsewhere: [], unrelated: ['zip code finder'] },
  gap_terms: 6, gap_search_volume: 8790,
  ...spend, cost: 0.0248,
};

export const localFixture: LocalResult = {
  business: 'Acme Plumbing', domain: 'acmeplumbing.example', location: 'Springfield,Illinois,United States', language: 'English',
  results: [
    { keyword: 'plumber', position: 2, listing: listing(2, 'Acme Plumbing'), top_3: [listing(1, 'Rival Plumbing', 4.8, 312), listing(2, 'Acme Plumbing'), listing(3, 'Pipe Pros')] },
    { keyword: 'water heater repair', position: 7, listing: listing(7, 'Acme Plumbing'), top_3: [listing(1, 'Rival Plumbing', 4.8, 312), listing(2, 'Hot Water Heroes', 4.9, 88), listing(3, 'Pipe Pros')] },
    { keyword: 'drain cleaning', position: null, listing: null, top_3: [listing(1, 'City Drains', 4.7, 540), listing(2, 'Rooter Bros', null, null), listing(3, 'Rival Plumbing', 4.8, 312)] },
  ],
  summary: { top_3: 1, lower: 1, not_found: 1 },
  ...spend, cost: 0.006,
};

export const aiFixture: AiResult = {
  domain: 'acmeplumbing.example', brand: 'Acme Plumbing',
  citations: { total: 3, by_platform: { google: 3 } },
  brand_mentions: { total: 1, by_platform: { chat_gpt: 1 } },
  topics: [
    { keyword: 'water heater repair', mentions: 90, cited: false, top_sources: [{ domain: 'rivalplumbing.example', mentions: 30 }, { domain: 'forum.example', mentions: 20 }, { domain: 'hardware.example', mentions: 9 }] },
    { keyword: 'sewer line repair', mentions: 40, cited: true, top_sources: [{ domain: 'acmeplumbing.example', mentions: 3 }] },
  ],
  top_prompts: [{ question: 'who fixes sewer lines in springfield', platform: 'google', ai_search_volume: 260, url: 'https://acmeplumbing.example/sewer' }],
  ...spend, cost: 0.206,
};

const move = (keyword: string, search_volume: number, from: number | null, to: number | null, url = '/') => ({ keyword, search_volume, from, to, url });

export const baselineFirstFixture: BaselineResult = {
  snapshot_id: '20260901-100000-pre-launch', domain: 'acmeplumbing.example', location: 'United States', language: 'English', limit: 100,
  keywords_tracked: keywords.length, keywords_total: 312, est_monthly_visits: 1241, keywords,
  positions: { top_3: 18, '4_10': 40, '11_20': 50, '21_100': 34 },
  compared_to: null, diff: null,
  ...spend, cost: 0.024,
};

export const baselineCompareFixture: BaselineResult = {
  ...baselineFirstFixture,
  snapshot_id: '20261008-120000',
  compared_to: { id: '20260901-100000-pre-launch', created: '2026-09-01T10:00:00.000Z', fetched_at: '2026-09-01T10:00:00.000Z', keywords_tracked: 12, same_data: false, compared_terms: 12, trimmed: false },
  diff: {
    gained: [move('hydro jetting', 1300, null, 9, '/drains/jetting'), move('backflow testing', 480, null, 15, '/backflow')],
    lost: [move('emergency plumber', 3600, 8, null)],
    improved: [move('plumber springfield', 2400, 4, 2), move('toilet repair', 210, 3, 1, '/toilets')],
    declined: [move('water heater repair', 1900, 6, 12, '/water-heaters'), move('drain cleaning', 880, 14, 15, '/drains')],
    unchanged: 7,
  },
};

export const baselineSameDataFixture: BaselineResult = {
  ...baselineFirstFixture,
  snapshot_id: '20261008-130000',
  compared_to: { id: '20261008-120000', created: '2026-10-08T12:00:00.000Z', fetched_at: spend.fetched_at, keywords_tracked: 12, same_data: true, compared_terms: 12, trimmed: false },
  diff: { gained: [], lost: [], improved: [], declined: [], unchanged: 12 },
  cached: true,
};

const check = (path: string, referring_domains: number, verdict: 'ok' | 'redirect-ok' | '404' | 'gated' | 'other', final_status: number | null, final?: string, home = false) => ({
  checked_url: `https://staging.acmeplumbing.example${path}`, old_urls: [`https://acmeplumbing.example${path}`], referring_domains,
  final_status, final_url: final === undefined ? `https://staging.acmeplumbing.example${path}` : final, verdict,
  ...(home ? { home_redirect: true as const } : {}), ...(final_status === null ? { error: 'fetch failed' } : {}),
});

export const redirectFixture: BacklinkRedirectsResult = {
  domain: 'acmeplumbing.example', new_origin: 'https://staging.acmeplumbing.example', total_pages_with_backlinks: 170, old_urls: 100, checked: 8,
  summary: { '404': 2, other: 1, gated: 1, 'redirect-ok': 3, ok: 1 },
  pages: [
    check('/coupons/spring-2019', 46, '404', 404),
    check('/services/water-heaters/', 11, '404', 404),
    check('/old-blog/frozen-pipes', 5, 'other', null, ''),
    check('/account', 4, 'gated', 200, 'https://staging.acmeplumbing.example/login?next=%2Faccount'),
    check('/about-us/', 59, 'redirect-ok', 200, 'https://staging.acmeplumbing.example/about'),
    check('/blog/2020/03/hello', 3, 'redirect-ok', 200, 'https://staging.acmeplumbing.example/', true),
    check('/drains/', 8, 'redirect-ok', 200, 'https://staging.acmeplumbing.example/services/drains'),
    check('/', 300, 'ok', 200),
  ],
  ...spend, cost: 0.0276,
};

const serp = (position: number, domain: string) => ({ position, domain, url: `https://${domain}/` });
const rankTerm = (keyword: string, position: number | null, path: string | null, features: string[] = [], fetched_at = spend.fetched_at): RankTerm => ({
  keyword, position, url: path && `https://www.acmeplumbing.example${path}`, title: path && 'Acme Plumbing', features,
  top_3: [serp(1, position === 1 ? 'acmeplumbing.example' : 'rivalplumbing.example'), serp(2, 'citydrains.example'), serp(3, 'pipes.example')],
  cost: 0.0006, cached: false, fetched_at,
});

export const rankFixture: RankCheckResult = {
  domain: 'acmeplumbing.example', location: 'Springfield,Illinois,United States', language: 'English', device: 'mobile', depth: 20, mode: 'queue',
  terms: [
    rankTerm('plumber springfield', 1, '/', ['local_pack', 'people_also_ask']),
    rankTerm('water heater repair', 4, '/water-heaters', ['paid']),
    rankTerm('drain cleaning', 14, '/drains'),
    rankTerm('emergency plumber', null, null, ['local_pack', 'ai_overview']),
    rankTerm('sump pump install', 9, '/sump-pumps'),
  ],
  summary: { top_3: 1, page_one: 3, lower: 1, not_found: 1 },
  ...spend, cost: 0.003,
};

export const rankPrevFixture: RankCheckResult = {
  ...rankFixture,
  terms: [
    rankTerm('plumber springfield', 2, '/', [], '2026-09-08T12:00:00.000Z'),
    rankTerm('water heater repair', 4, '/water-heaters', [], '2026-09-08T12:00:00.000Z'),
    rankTerm('drain cleaning', 18, '/drains', [], '2026-09-08T12:00:00.000Z'),
    rankTerm('emergency plumber', 7, '/', [], '2026-09-08T12:00:00.000Z'),
    rankTerm('sump pump install', null, null, [], '2026-09-08T12:00:00.000Z'),
  ],
  fetched_at: '2026-09-08T12:00:00.000Z',
};

/** One spec per report, keyed by its slug suffix. */
export function sampleReports(date = '2026-10-08'): Record<string, ReportSpec> {
  return {
    'seo-snapshot': snapshotReport(snapshotFixture, date),
    'competitor-gap': gapReport(gapFixture, date),
    'local-visibility': localReport(localFixture, date),
    'ai-visibility': aiReport(aiFixture, date),
    'rank-baseline': baselineReport(baselineFirstFixture, date),
    'rank-check': baselineReport(baselineCompareFixture, date),
    'rank-check-same-data': baselineReport(baselineSameDataFixture, date),
    'backlink-redirects': redirectReport(redirectFixture, date),
    'live-rank-check': rankReport(rankFixture, date),
    'live-rank-check-since': rankReport(rankFixture, date, rankPrevFixture),
  };
}
