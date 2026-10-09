import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aiVisibility, balance, classify, competitorCandidates, competitorGap, createDiskSnapshotStore, diffSnapshots, domainStem,
  isBrandKeyword, isNoiseCompetitor, localVisibility, matchesBusiness, mentions, mergeGaps, parseTopics, rankBaseline,
  relevanceFor, seoSnapshot, snapshotId, snapshotOpportunities, topPages, type RankSnapshot,
} from './index.js';
import { fakeClient, ranked, RANKED } from './test/api.js';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const LABS = '/dataforseo_labs/google';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dfs-checks-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const setup = (routes: Parameters<typeof fakeClient>[0], now: () => number = () => NOW) => fakeClient(routes, join(dir, 'cache'), now);

describe('balance', () => {
  it('reports balance, deposits, spend and today', async () => {
    const { client } = setup({
      '/appendix/user_data': () => [{ login: 'demo', money: { total: 50, balance: 49.9724, statistics: { day: { value: '2026-10-08', total: 0.05196 } } } }, 0],
    });

    expect(await balance(client)).toStrictEqual({
      login: 'demo', balance: 49.9724, deposited: 50, spent: 0.0276, cost: 0, cached: false,
      today: { date: '2026-10-08', total: 0.05196 },
    });
  });
});

describe('seoSnapshot', () => {
  const routes = { [`${LABS}/ranked_keywords/live`]: () => [RANKED, 0.0144] as [unknown, number] };

  it('asks ranked_keywords for organic terms by estimated visits, US English by default', async () => {
    const { client, calls } = setup(routes);

    await seoSnapshot(client, { domain: 'https://www.Acme.example/' }, () => NOW);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toStrictEqual({
      target: 'acme.example', location_name: 'United States', language_name: 'English',
      item_types: ['organic'], limit: 100, order_by: ['ranked_serp_element.serp_item.etv,desc'],
    });
  });

  it('parses visits, position bands, keywords and pages; a rerun is free', async () => {
    const { client } = setup(routes);
    const input = { domain: 'acme.example', location: 'Ohio,United States', limit: 4 };

    const first = await seoSnapshot(client, input, () => NOW);
    const second = await seoSnapshot(client, input, () => NOW);

    expect(first).toMatchObject({
      est_monthly_visits: 1241, keywords_total: 312, cost: 0.0144, cached: false,
      positions: { top_3: 18, '4_10': 40, '11_20': 50, '21_100': 34 },
    });
    expect(first.top_keywords[1]).toStrictEqual({ keyword: 'water heater repair', position: 6, search_volume: 1900, etv: 120, url: '/water-heaters', kind: 'unsorted' });
    expect(first.top_pages[0]).toStrictEqual({ url: '/', keywords: 2, etv: 590 });
    expect(second).toMatchObject({ cost: 0, cached: true });
  });
});

describe('competitorCandidates', () => {
  const routes = {
    [`${LABS}/ranked_keywords/live`]: () => [{
      ...RANKED,
      items: [
        ranked('acme plumbing', 1, 900, 800, '/'),
        ranked('Acme-Plumbing reviews', 1, 50, 40, '/reviews'),
        ranked('water heater repair', 6, 1900, 120, '/water-heaters'),
        ranked('no volume term', 3, 0, 0, '/x'),
        ranked('drain cleaning', 14, 880, 20, '/drains'),
      ],
    }, 0.0144] as [unknown, number],
    [`${LABS}/serp_competitors/live`]: () => [{
      items: [
        { domain: 'www.acme.example', keywords_count: 2, avg_position: 1 },
        { domain: 'springfield.gov', keywords_count: 2, avg_position: 4 },
        { domain: 'www.yelp.com', keywords_count: 2, avg_position: 2 },
        { domain: 'third.example', keywords_count: 1, avg_position: 2 },
        { domain: 'www.rival.example', keywords_count: 2, avg_position: 5.25, etv: 310.6 },
        { domain: 'other.example', keywords_count: 2, avg_position: 3, etv: 90 },
        { domain: 'state.edu', keywords_count: 1, avg_position: 9 },
      ],
    }, 0.0156] as [unknown, number],
  };

  it('compares on the domain\'s non-brand terms and filters directories and public bodies', async () => {
    const { client, calls, paths } = setup(routes);

    const result = await competitorCandidates(client, { domain: 'acme-plumbing.example', limit: 3 }, () => NOW);

    expect(paths()).toStrictEqual([`${LABS}/ranked_keywords/live`, `${LABS}/serp_competitors/live`]);
    expect(calls[1]!.body).toStrictEqual({
      keywords: ['water heater repair', 'drain cleaning'],
      location_name: 'United States', language_name: 'English',
      item_types: ['organic'], limit: 30, order_by: ['keywords_count,desc', 'avg_position,asc'],
    });
    expect(result.keywords_source).toBe('rankings');
    expect(result.candidates).toStrictEqual([
      { domain: 'acme.example', keywords_matched: 2, avg_position: 1, etv: 0 },
      { domain: 'other.example', keywords_matched: 2, avg_position: 3, etv: 90 },
      { domain: 'rival.example', keywords_matched: 2, avg_position: 5.3, etv: 311 },
    ]);
    expect(result.filtered_out).toStrictEqual(['springfield.gov', 'yelp.com', 'state.edu']);
    expect(result).toMatchObject({ cost: 0.03, cached: false });
  });

  it('reuses a recent snapshot pull for free', async () => {
    const { client, paths } = setup(routes);

    await seoSnapshot(client, { domain: 'acme.example' }, () => NOW);
    const result = await competitorCandidates(client, { domain: 'acme.example' }, () => NOW);

    expect(paths().filter((p) => p.endsWith('/ranked_keywords/live'))).toHaveLength(1);
    expect(result.cost).toBe(0.0156);
  });

  it('given keywords skip the rankings pull, deduplicated and trimmed', async () => {
    const { client, calls, paths } = setup(routes);

    const result = await competitorCandidates(client, {
      domain: 'acme.example', keywords: ['Tankless Water Heater', ' sump pump repair ', 'tankless water heater', ''],
    }, () => NOW);

    expect(paths()).toStrictEqual([`${LABS}/serp_competitors/live`]);
    expect(calls[0]!.body.keywords).toStrictEqual(['tankless water heater', 'sump pump repair']);
    expect(result).toMatchObject({ keywords_source: 'given', cost: 0.0156 });
  });

  it('makes no paid discovery call when only brand terms rank', async () => {
    const { client, calls } = setup({
      [`${LABS}/ranked_keywords/live`]: () => [{ ...RANKED, items: [ranked('acme', 1, 500, 400, '/'), ranked('acme plumbing co', 1, 2000, 900, '/')] }, 0.0144],
    });

    const result = await competitorCandidates(client, { domain: 'acme.example', brand: 'Acme Plumbing Co' }, () => NOW);

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ candidates: [], keywords_used: [], cost: 0.0144 });
  });
});

describe('competitorGap', () => {
  const gapItem = (keyword: string, volume: number, pos: number, mine: number | null = null) => ({
    keyword_data: { keyword, keyword_info: { search_volume: volume } },
    first_domain_serp_element: { type: 'organic', rank_group: pos, relative_url: `/${keyword.replace(/ /g, '-')}` },
    second_domain_serp_element: mine ? { type: 'organic', rank_group: mine, relative_url: '/ours' } : null,
  });
  const routes = {
    [`${LABS}/domain_intersection/live`]: (body: any) => [body.intersections ? {
      total_count: 2,
      items: body.target1 === 'rival.example'
        ? [gapItem('drain cleaning', 880, 2, 14), gapItem('plumber springfield', 2400, 4, 1)]
        : [gapItem('drain cleaning', 880, 5, 14)],
    } : {
      total_count: body.target1 === 'rival.example' ? 40 : 2,
      items: body.target1 === 'rival.example'
        ? [gapItem('tankless water heater', 5000, 3), gapItem('sump pump', 900, 7), gapItem('rival coupons', 700, 1), gapItem('zip code finder', 20000, 9)]
        : [gapItem('sump pump', 900, 2)],
    }, 0.0124] as [unknown, number],
  };

  it('pulls shared and missing page-one terms per competitor and keeps topic terms', async () => {
    const { client, calls } = setup(routes);

    const result = await competitorGap(client, {
      domain: 'acme.example', competitors: ['https://www.rival.example', 'other.example', 'acme.example', 'rival.example'],
      topics: ['Plumbing: plumber, drain, sump pump', 'Water heaters: water heater'],
    }, () => NOW);

    const bodies = calls.map((c) => c.body);
    expect(bodies.map((b) => `${b.target1} ${b.intersections}`).sort()).toStrictEqual(['other.example false', 'other.example true', 'rival.example false', 'rival.example true']);
    expect(bodies[0]).toMatchObject({
      target2: 'acme.example', limit: 100, order_by: ['keyword_data.keyword_info.search_volume,desc'],
      filters: [['first_domain_serp_element.rank_group', '<=', 10]],
    });
    expect(result.gaps.map((g) => [g.keyword, g.gap, g.theme, g.position])).toStrictEqual([
      ['tankless water heater', 'missing', 'Water heaters', null],
      ['sump pump', 'missing', 'Plumbing', null],
      ['drain cleaning', 'weak', 'Plumbing', 14],
    ]);
    expect(result.gaps[1]!.competitors).toStrictEqual([
      { domain: 'other.example', position: 2, url: '/sump-pump' },
      { domain: 'rival.example', position: 7, url: '/sump-pump' },
    ]);
    expect(result.excluded).toStrictEqual({ brand: 0, other_name: 1, elsewhere: 0, unrelated: 1, ahead: 1 });
    expect(result.competitors[0]).toStrictEqual({ domain: 'rival.example', missing_total: 40, shared_total: 2, checked: 4 });
    expect(result).toMatchObject({ gap_terms: 3, gap_search_volume: 5000 + 900 + 880, cost: 0.0496, cached: false });
  });

  it('refuses without a competitor other than the domain, before paying', async () => {
    const { client, calls } = setup(routes);

    await expect(competitorGap(client, { domain: 'acme.example', competitors: ['www.acme.example'] })).rejects.toThrow(/at least one competitor/);
    expect(calls).toHaveLength(0);
  });
});

describe('localVisibility', () => {
  const listing = (rank: number, title: string, domain: string | null, rating?: number, votes?: number) => ({
    type: 'maps_search', rank_group: rank, title, domain, rating: rating ? { value: rating, votes_count: votes } : null, category: 'Plumber',
    ...(domain ? { url: `https://${domain}/`, cid: '42' } : {}),
  });
  const routes = {
    '/serp/google/maps/live/advanced': (body: any) => [{
      items: body.keyword === 'plumber'
        ? [listing(1, 'Rival Plumbing', 'rival.example', 4.8, 312), { type: 'maps_paid_item', title: 'Ad' }, listing(2, 'Acme Plumbing LLC', null), listing(3, 'Third', null)]
        : [listing(1, 'Rival Plumbing', 'rival.example', 4.8, 312), listing(2, 'B', null), listing(3, 'C', null), listing(9, 'Other', 'www.acme.example')],
    }, 0.002] as [unknown, number],
  };
  const where = 'Springfield,Illinois,United States';

  it('makes one Maps call per unique term at depth 20 and matches by name or domain', async () => {
    const { client, calls } = setup(routes);

    const result = await localVisibility(client, {
      business: 'Acme Plumbing', domain: 'acme.example', keywords: ['plumber', 'drain cleaning', 'plumber'], location: where,
    }, () => NOW);

    // Calls run in parallel, so their order isn't fixed.
    expect(calls.map((c) => c.body).sort((a, b) => b.keyword.localeCompare(a.keyword))).toStrictEqual([
      { keyword: 'plumber', location_name: where, language_name: 'English', depth: 20 },
      { keyword: 'drain cleaning', location_name: where, language_name: 'English', depth: 20 },
    ]);
    expect(result.results.map((r) => [r.keyword, r.position])).toStrictEqual([['plumber', 2], ['drain cleaning', 9]]);
    expect(result.results[0]!.top_3.map((l) => l.title)).toStrictEqual(['Rival Plumbing', 'Acme Plumbing LLC', 'Third']);
    expect(result.results[0]!.top_3[0]).toMatchObject({ url: 'https://rival.example/', maps_url: 'https://www.google.com/maps?cid=42' });
    expect(result.results[0]!.top_3[1]).toMatchObject({ url: null, maps_url: null });
    expect(result).toMatchObject({ summary: { top_3: 1, lower: 1, not_found: 0 }, cost: 0.004, cached: false });
  });

  it('sends coordinates as location_coordinate', async () => {
    const { client, calls } = setup(routes);

    await localVisibility(client, { business: 'Acme', keywords: ['plumber'], location: '39.78, -89.65, 13z' });

    expect(calls[0]!.body).toMatchObject({ location_coordinate: '39.78,-89.65,13z' });
    expect(calls[0]!.body.location_name).toBeUndefined();
  });

  it('refuses more terms than max_keywords before paying', async () => {
    const { client, calls } = setup(routes);

    await expect(localVisibility(client, { business: 'Acme', keywords: ['a', 'b', 'c', 'd', 'e', 'f'], location: 'Springfield' }))
      .rejects.toThrow(/more than max_keywords \(5\)/);
    expect(calls).toHaveLength(0);
  });
});

describe('aiVisibility', () => {
  const LLM = '/ai_optimization/llm_mentions';

  it('domain only: one target_metrics_lite call; prompts adds search_mentions', async () => {
    const { client, calls, paths } = setup({
      [`${LLM}/target_metrics_lite/live`]: () => [{
        items: [{ platform: 'google', metrics: { mentions: 3 } }, { platform: 'chat_gpt', metrics: { mentions: 11 } }],
      }, 0.101],
      [`${LLM}/search_mentions/live`]: () => [{
        items: [{
          platform: 'chat_gpt', question: 'best plumber in springfield', ai_search_volume: 400,
          sources: [{ domain: 'www.acme.example', url: 'https://www.acme.example/about' }],
        }],
      }, 0.101],
    });

    const plain = await aiVisibility(client, { domain: 'acme.example' }, () => NOW);
    expect(paths()).toStrictEqual([`${LLM}/target_metrics_lite/live`]);
    expect(plain).toMatchObject({ top_prompts: [], cost: 0.101 });

    const result = await aiVisibility(client, { domain: 'acme.example', prompts: 5 }, () => NOW);

    const cited = { domain: 'acme.example', search_scope: ['sources'], include_subdomains: true };
    expect(calls[0]!.body).toStrictEqual({ target: [cited], location_code: 2840, language_code: 'en' });
    expect(calls[1]!.body).toStrictEqual({ target: [cited], location_code: 2840, language_code: 'en', limit: 5, order_by: ['ai_search_volume,desc'] });
    expect(result.citations).toStrictEqual({ total: 14, by_platform: { google: 3, chat_gpt: 11 } });
    expect(result.top_prompts).toStrictEqual([{ question: 'best plumber in springfield', platform: 'chat_gpt', ai_search_volume: 400, url: 'https://www.acme.example/about' }]);
    expect(result).toMatchObject({ cost: 0.101, cached: false });
  });

  it('brand and topics: one multi_target_metrics call', async () => {
    const { client, calls } = setup({
      [`${LLM}/multi_target_metrics/live`]: () => [{
        items: [
          { key: 'cited', platform: [{ key: 'chat_gpt', mentions: 0 }] },
          { key: 'brand', platform: [{ key: 'chat_gpt', mentions: 2 }, { key: 'google', mentions: 1 }] },
          { key: 'topic:water heaters', platform: [{ key: 'google', mentions: 90 }], sources_domain: [{ key: 'www.rival.example', mentions: 30 }, { key: 'forum.example', mentions: 20 }] },
        ],
      }, 0.103],
    });

    const result = await aiVisibility(client, { domain: 'acme.example', brand: 'Acme Plumbing', keywords: ['water heaters'] }, () => NOW);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.targets).toStrictEqual([
      { key: 'cited', target: [{ domain: 'acme.example', search_scope: ['sources'], include_subdomains: true }] },
      { key: 'brand', target: [{ keyword: 'Acme Plumbing', search_scope: ['answer'] }] },
      { key: 'topic:water heaters', target: [{ keyword: 'water heaters', search_scope: ['question'] }] },
    ]);
    expect(result.brand_mentions).toStrictEqual({ total: 3, by_platform: { chat_gpt: 2, google: 1 } });
    expect(result.topics).toStrictEqual([{
      keyword: 'water heaters', mentions: 90, cited: false,
      top_sources: [{ domain: 'rival.example', mentions: 30 }, { domain: 'forum.example', mentions: 20 }],
    }]);
    expect(result.cost).toBe(0.103);
  });
});

describe('rankBaseline', () => {
  const RL = `${LABS}/ranked_keywords/live`;
  const snapshots = () => createDiskSnapshotStore(join(dir, 'snapshots'));

  it('saves a snapshot, then compares the next one with it', async () => {
    let t = Date.parse('2026-09-01T10:00:00Z');
    let items = RANKED.items;
    const { client, calls } = setup({ [RL]: () => [{ ...RANKED, items }, 0.024] }, () => t);
    const store = snapshots();

    const first = await rankBaseline(client, store, { domain: 'acme.example', label: 'Pre launch' }, () => t);
    expect(first).toMatchObject({ snapshot_id: '20260901-100000-pre-launch', keywords_tracked: 4, compared_to: null, diff: null, cost: 0.024 });
    expect(calls[0]!.body).toMatchObject({ limit: 100 });

    t = Date.parse('2026-10-01T10:00:00Z');
    items = [
      ranked('plumber springfield', 1, 2400, 600, '/'),
      ranked('water heater repair', 12, 1900, 10, '/water-heaters'),
      ranked('drain cleaning', 14, 880, 20, '/drains'),
      ranked('sewer line', 5, 300, 15, '/sewer'),
    ];
    const second = await rankBaseline(client, store, { domain: 'acme.example', refresh: true }, () => t);

    expect(second.compared_to).toMatchObject({ id: '20260901-100000-pre-launch', same_data: false });
    expect(second.diff!.gained.map((m) => m.keyword)).toStrictEqual(['sewer line']);
    expect(second.diff!.lost).toStrictEqual([{ keyword: 'emergency plumber', search_volume: 3600, from: 8, to: null, url: '/' }]);
    expect(second.diff!.improved.map((m) => m.keyword)).toStrictEqual(['plumber springfield']);
    expect(second.diff!.declined).toStrictEqual([{ keyword: 'water heater repair', search_volume: 1900, from: 6, to: 12, url: '/water-heaters' }]);
    expect(second.diff!.unchanged).toBe(1);

    const saved = JSON.parse(await readFile(join(dir, 'snapshots', 'acme.example', `${second.snapshot_id}.json`), 'utf8'));
    expect(saved.keywords).toHaveLength(4);
  });

  it('flags a rerun on the same cached data', async () => {
    let t = Date.parse('2026-10-08T10:00:00Z');
    const { client } = setup({ [RL]: () => [RANKED, 0.024] }, () => t);
    const store = snapshots();

    await rankBaseline(client, store, { domain: 'acme.example' }, () => t);
    t += 60_000;
    const second = await rankBaseline(client, store, { domain: 'acme.example' }, () => t);

    expect(second).toMatchObject({ cached: true, compared_to: { same_data: true } });
  });

  describe('sets of different sizes', () => {
    const many = (n: number, shift = 0) => Array.from({ length: n }, (_, i) => ranked(`term ${i + 1}`, 10 + (i < 3 ? shift : 0), 1000 - i, 100 - i, '/'));
    const run = (clock: () => number, shift: () => number = () => 0) => {
      const { client } = setup({ [RL]: (body) => [{ ...RANKED, items: many(body.limit, shift()) }, 0.02] }, clock);
      const store = snapshots();
      return (limit: number) => rankBaseline(client, store, { domain: 'acme.example', limit }, clock);
    };

    it('treats a smaller check on the same day as the same data', async () => {
      let t = Date.parse('2026-10-09T10:00:00Z');
      const baseline = run(() => t);

      await baseline(1000);
      t += 3_600_000;
      const check = await baseline(100);

      expect(check.compared_to).toMatchObject({ same_data: true, compared_terms: 100, trimmed: true, keywords_tracked: 1000 });
    });

    it('compares the top terms of both sets on different days', async () => {
      let t = Date.parse('2026-09-09T10:00:00Z');
      let shift = 0;
      const baseline = run(() => t, () => shift);

      await baseline(1000);
      t = Date.parse('2026-10-09T10:00:00Z');
      shift = -2;
      const check = await baseline(100);

      expect(check.compared_to).toMatchObject({ same_data: false, compared_terms: 100, trimmed: true });
      expect(check.diff).toMatchObject({ lost: [], gained: [], unchanged: 97 });
      expect(check.diff!.improved).toHaveLength(3);
    });

    it('leaves equal limits untrimmed', async () => {
      let t = Date.parse('2026-09-09T10:00:00Z');
      const baseline = run(() => t);

      await baseline(100);
      t = Date.parse('2026-10-09T10:00:00Z');
      const check = await baseline(100);

      expect(check.compared_to).toMatchObject({ same_data: false, compared_terms: 100, trimmed: false });
      expect(check.diff!.unchanged).toBe(100);
    });

    it('compares with the latest prior snapshot with a limit at least as large', async () => {
      let t = Date.parse('2026-08-09T10:00:00Z');
      const baseline = run(() => t);

      const big = await baseline(1000);
      t = Date.parse('2026-09-09T10:00:00Z');
      await baseline(50);
      t = Date.parse('2026-10-09T10:00:00Z');
      const check = await baseline(100);

      expect(check.compared_to!.id).toBe(big.snapshot_id);
    });
  });

  it('compare_to picks a specific snapshot and errors on an unknown or unsafe id', async () => {
    const { client } = setup({ [RL]: () => [RANKED, 0.024] });
    const store = snapshots();

    await expect(rankBaseline(client, store, { domain: 'acme.example', compare_to: 'nope' })).rejects.toThrow(/No snapshot "nope"/);
    await expect(rankBaseline(client, store, { domain: 'acme.example', compare_to: '../x' })).rejects.toThrow(/Invalid snapshot id/);
  });

  it('ignores snapshots taken for another location', async () => {
    let t = Date.parse('2026-09-01T10:00:00Z');
    const { client } = setup({ [RL]: () => [RANKED, 0.024] }, () => t);
    const store = snapshots();

    await rankBaseline(client, store, { domain: 'acme.example', location: 'Canada' }, () => t);
    t += 60_000;
    const result = await rankBaseline(client, store, { domain: 'acme.example' }, () => t);

    expect(result.compared_to).toBeNull();
  });
});

describe('helpers', () => {
  it('domainStem and isBrandKeyword', () => {
    expect(domainStem('https://www.Acme-Plumbing.example/x')).toBe('acmeplumbing');
    expect(domainStem('acme.co.uk')).toBe('acme');
    expect(domainStem('shop.abc.example')).toBe('abc');
    expect(isBrandKeyword('Acme Plumbing hours', ['acmeplumbing'])).toBe(true);
    expect(isBrandKeyword('plumber near me', ['acmeplumbing'])).toBe(false);
    expect(isBrandKeyword('ab testing', ['ab'])).toBe(false);
  });

  it('isNoiseCompetitor drops public bodies, directories and social sites only', () => {
    for (const d of ['springfield.gov', 'city.gov.au', 'state.edu', 'army.mil', 'district.k12.il.us', 'www.yelp.com', 'm.facebook.com', 'en.wikipedia.org']) {
      expect(isNoiseCompetitor(d), d).toBe(true);
    }
    for (const d of ['rival.example', 'governorsplumbing.example', 'yelpless.example', 'educare.example']) {
      expect(isNoiseCompetitor(d), d).toBe(false);
    }
  });

  it('matchesBusiness by domain or name, ignoring suffixes', () => {
    const l = (title: string, domain: string | null = null) => ({ position: 1, title, domain, rating: null, reviews: null, category: null });
    expect(matchesBusiness(l('Acme Plumbing, LLC'), 'Acme Plumbing')).toBe(true);
    expect(matchesBusiness(l('Something', 'www.acme.example'), 'Acme', 'acme.example')).toBe(true);
    expect(matchesBusiness(l('Acme Roofing'), 'Acme Plumbing')).toBe(false);
    expect(matchesBusiness(l('AB'), 'AB')).toBe(false);
  });

  it('mergeGaps sorts by volume, collects competitors and drops terms off page one or where the domain leads', () => {
    const item = (keyword: string, volume: number, theirs = 1, ours: number | null = null) => ({
      keyword_data: { keyword, keyword_info: { search_volume: volume }, search_intent_info: { main_intent: 'informational' } },
      first_domain_serp_element: { rank_group: theirs, relative_url: '/' },
      second_domain_serp_element: ours ? { rank_group: ours, relative_url: '/o' } : null,
    });
    const gaps = mergeGaps([
      { domain: 'a.example', shared: false, items: [item('x', 10), item('deep', 900, 40)] },
      { domain: 'b.example', shared: false, items: [item('y', 50), item('x', 10, 3)] },
      { domain: 'b.example', shared: true, items: [item('behind', 70, 2, 9), item('ahead', 80, 6, 2)] },
    ], relevanceFor({ domain: 'me.example' }));

    expect(gaps.map((g) => [g.keyword, g.gap, g.competitors.length, g.position])).toStrictEqual([['behind', 'weak', 1, 9], ['y', 'missing', 1, null], ['x', 'missing', 2, null]]);
    expect(gaps[0]).toMatchObject({ intent: 'informational', kind: 'unsorted', url: '/o' });
  });

  it('classify sorts brand, topic, other names and unrelated terms', () => {
    const r = relevanceFor({
      domain: 'acme-plumbing.example', brand: 'Acme Plumbing', aliases: ['Pipe Pros Riverside'], competitors: ['rivalplumbing.example'],
      topics: ['Plumbing: plumber, pipe', 'Water heaters: water heater'],
    });
    expect(parseTopics(['Plumbing: plumber, pipe', ' drains ', ''])).toStrictEqual([{ label: 'Plumbing', words: ['plumber', 'pipe'] }, { label: 'drains', words: ['drains'] }]);
    expect(mentions('pipes near me', 'pipe')).toBe(true);
    expect(mentions('bagpipe lessons', 'pipe')).toBe(false);
    expect(classify('acme plumbing jobs', undefined, r)).toStrictEqual({ kind: 'brand' });
    expect(classify('pipe pros riverside hours', 'navigational', r)).toStrictEqual({ kind: 'brand' });
    expect(classify('rival plumbing coupons', undefined, r)).toStrictEqual({ kind: 'other-name' });
    expect(classify('burst pipe repair', 'commercial', r)).toStrictEqual({ kind: 'topic', theme: 'Plumbing' });
    expect(classify('riverside diner', 'navigational', r)).toStrictEqual({ kind: 'other-name' });
    expect(classify('zip code finder', 'informational', r)).toStrictEqual({ kind: 'unrelated' });
    expect(classify('zip code finder', 'informational', relevanceFor({ domain: 'acme.example' }))).toStrictEqual({ kind: 'unsorted' });

    const local = relevanceFor({ domain: 'acme.example', topics: ['Plumbing: plumber'], area: ['Springfield', 'Illinois', 'Washington county'] });
    expect(classify('plumber san antonio texas', undefined, local)).toStrictEqual({ kind: 'elsewhere' });
    expect(classify('plumber springfield ohio', undefined, local)).toStrictEqual({ kind: 'elsewhere' });
    expect(classify('plumber springfield illinois', undefined, local)).toStrictEqual({ kind: 'topic', theme: 'Plumbing' });
    expect(classify('plumber washington', undefined, local)).toStrictEqual({ kind: 'topic', theme: 'Plumbing' });
  });

  it('topPages and snapshotOpportunities', () => {
    const kws = RANKED.items.map((i) => ({
      keyword: i.keyword_data.keyword, position: i.ranked_serp_element.serp_item.rank_group,
      search_volume: i.keyword_data.keyword_info.search_volume, etv: i.ranked_serp_element.serp_item.etv, url: i.ranked_serp_element.serp_item.relative_url,
    }));
    expect(topPages(kws).map((p) => p.url)).toStrictEqual(['/', '/water-heaters', '/drains']);

    const kinds: Record<string, any> = { 'emergency plumber': { kind: 'topic', theme: 'Plumbing' }, 'water heater repair': { kind: 'unrelated' }, 'drain cleaning': { kind: 'topic', theme: 'Plumbing' } };
    const classified = kws.map((k) => ({ ...k, ...(kinds[k.keyword] ?? { kind: 'brand' }) }));
    expect(snapshotOpportunities(classified).map((k) => k.keyword)).toStrictEqual(['emergency plumber', 'drain cleaning']);

    const t = (keyword: string, search_volume: number, url: string, intent: string) => ({ keyword, position: 6, search_volume, etv: 1, url, intent, kind: 'topic' as const });
    expect(snapshotOpportunities([t('store a', 2400, '/a', 'navigational'), t('store a b', 2000, '/a', 'navigational'), t('how to fix a leak', 300, '/b', 'informational')])
      .map((k) => [k.keyword, k.similar])).toStrictEqual([['how to fix a leak', 0], ['store a', 1]]);
  });

  it('snapshotId and diffSnapshots', () => {
    expect(snapshotId('2026-10-08T17:53:00.123Z')).toBe('20261008-175300');
    expect(snapshotId('2026-10-08T17:53:00.123Z', ' Post Launch! ')).toBe('20261008-175300-post-launch');
    const snap = (keywords: [string, number][]): RankSnapshot => ({
      id: 'x', domain: 'a.example', location: 'United States', language: 'English', created: '', fetched_at: '', total_keywords: 0, etv: 0,
      keywords: keywords.map(([keyword, position]) => ({ keyword, position, search_volume: 1, etv: 0, url: '/' })),
    });
    expect(diffSnapshots(snap([['a', 1], ['b', 5]]), snap([['b', 5], ['c', 2]])))
      .toMatchObject({ unchanged: 1, gained: [{ keyword: 'c' }], lost: [{ keyword: 'a', from: 1, to: null }] });
  });
});
