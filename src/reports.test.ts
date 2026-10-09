import { describe, it, expect } from 'vitest';
import { aiReport, buildReport, funnels, usd, gapReport, localReport, rankReport, snapshotReport, redirectReport, type Block } from './index.js';
import { aiFixture, gapFixture, localFixture, rankFixture, rankPrevFixture, redirectFixture, sampleReports, snapshotFixture } from './test/report-fixtures.js';

function find(blocks: Block[], id: string): any {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.type === 'details') {
      const hit = find(b.blocks, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

const allIds = (blocks: Block[]) => blocks.flatMap((b) => [b.id, ...(b.type === 'details' ? b.blocks.map((c) => c.id) : [])]);
const ids = (blocks: Block[]) => new Set(allIds(blocks));

describe('report blocks', () => {
  for (const [name, spec] of Object.entries(sampleReports())) {
    it(`${name} has unique block ids, says how it was measured and links its tiles to sections`, () => {
      const blocks = buildReport(spec);
      expect(new Set(allIds(blocks)).size).toBe(allIds(blocks).length);
      expect(find(blocks, 'method')).toMatchObject({ type: 'details', summary: 'How this was measured' });
      expect(blocks.map((b) => b.id)).toEqual(expect.arrayContaining(['title', 'answer', 'stats', 'method', 'actions-title', 'footer']));
      for (const s of find(blocks, 'stats').items) {
        if (s.href) expect(ids(blocks)).toContain(s.href.slice(1));
      }
      expect(spec.method.map((m) => m.label)).toEqual(expect.arrayContaining(['What', 'When', 'Source']));
    });
  }

  it('all-clear variants say what was checked', () => {
    const empty = [
      snapshotReport({ ...snapshotFixture, top_keywords: snapshotFixture.top_keywords.filter((k) => k.kind !== 'topic' || k.position <= 3) }, '2026-10-08'),
      gapReport({ ...gapFixture, gaps: [], gap_terms: 0, gap_search_volume: 0 }, '2026-10-08'),
      localReport({ ...localFixture, results: [localFixture.results[0]], summary: { top_3: 1, lower: 0, not_found: 0 } }, '2026-10-08'),
      redirectReport({ ...redirectFixture, pages: redirectFixture.pages.filter((p) => p.verdict === 'ok') }, '2026-10-08'),
      rankReport({ ...rankFixture, terms: rankFixture.terms.filter((t) => t.position !== null && t.position <= 10) }, '2026-10-08'),
      rankReport(rankFixture, '2026-10-08', rankFixture),
    ];
    for (const spec of empty) {
      const blocks = buildReport(spec);
      expect(find(blocks, 'all-clear')).toMatchObject({ type: 'callout', tone: 'good' });
      expect(find(blocks, 'all-clear').text).not.toMatch(/^Nothing needs attention/);
    }
  });

  it('snapshot recommends only topic terms at #4 to #20 and reports unrelated traffic', () => {
    const blocks = buildReport(sampleReports()['seo-snapshot']);

    expect(find(blocks, 'actions').rows.map((r: any) => r.keyword)).toStrictEqual(['emergency plumber', 'water heater repair', 'drain cleaning', 'tankless water heater install', 'garbage disposal repair']);
    expect(find(blocks, 'off-topic').rows.map((r: any) => [r.keyword, r.about])).toStrictEqual([
      ['riverside coffee', 'Another name or place'],
      ['best podcasts 2026', 'Unrelated'],
    ]);
    expect(find(blocks, 'stats').items.at(-1)).toMatchObject({ label: 'Visits not about your work', value: '7%', href: '#off-topic-title' });
    expect(find(blocks, 'positions').columns[2]).toMatchObject({ format: 'bar' });
    const top = find(blocks, 'top-terms');
    expect(top).toMatchObject({ visible: 10, sortable: true });
    expect(top.columns.find((c: any) => c.key === 'position')).toMatchObject({ format: 'badge', tones: { '#2': 'neutral', '#8': 'neutral', '#14': 'neutral' } });
    expect(top.columns.find((c: any) => c.key === 'url')).toMatchObject({ format: 'path' });
  });

  it('snapshot without topics recommends by position alone and says terms are unsorted', () => {
    const spec = snapshotReport({
      ...snapshotFixture,
      relevance: { aliases: [], topics: [], area: [] },
      top_keywords: snapshotFixture.top_keywords.map((k) => ({ ...k, kind: k.kind === 'brand' ? 'brand' : 'unsorted', theme: undefined })),
    }, '2026-10-08');
    expect(spec.method.find((m) => m.label === 'Sorting')?.text).toMatch(/aren’t sorted by topic/);
    expect(spec.stats.map((s) => s.label)).not.toContain('Visits not about your work');
  });

  it('gap groups by topic and shows both positions for weak terms', () => {
    const blocks = buildReport(sampleReports()['competitor-gap']);

    expect(find(blocks, 'themes').rows[0]).toMatchObject({ theme: 'Water heaters', weak: 2, missing: 0, leader: 'rivalplumbing.example' });
    expect(find(blocks, 'weak').rows[0]).toMatchObject({ keyword: 'tankless water heater', them: '[rivalplumbing.example #3](https://rivalplumbing.example/)', you: '#14', url: '[/services](https://acmeplumbing.example/services)' });
    expect(find(blocks, 'missing').rows.map((r: any) => r.keyword)).toContain('sump pump installation');
    expect(find(blocks, 'competitors').rows[0]).toStrictEqual({ domain: '[rivalplumbing.example](https://rivalplumbing.example)', weak: 2, missing: 3, shared: 60, all: 140 });
    const filter = gapReport(gapFixture, '2026-10-08').method.find((m) => m.label === 'Filter')?.text;
    expect(filter).toMatch(/Left out: 3 terms naming a competitor or another business \(like “rival plumbing coupons”\), 12 unrelated to your work \(like “zip code finder”\) and 4 where you already rank ahead/);
  });

  it('AI report separates mentions from citations and never claims topics it didn’t check', () => {
    const named = aiReport({ ...aiFixture, citations: { total: 3, by_platform: { google: 3, chat_gpt: 0 } }, brand_mentions: { total: 961, by_platform: { chat_gpt: 960, google: 1 } } }, '2026-10-08');
    expect(named.answer).toMatch(/ChatGPT names it 960 times but never links acmeplumbing.example/);
    expect(find(buildReport(named), 'platforms').rows).toStrictEqual([
      { platform: 'ChatGPT', mentions: 960, citations: 0 },
      { platform: 'Google AI Overviews', mentions: 1, citations: 3 },
    ]);

    const none = aiReport({ ...aiFixture, topics: [], top_prompts: [], brand_mentions: { total: 2, by_platform: { chat_gpt: 1, google: 1 } } }, '2026-10-08');
    expect(none.allClear).toMatch(/No topics were checked/);
    expect(none.method.find((m) => m.label === 'Topics')?.text).toMatch(/None checked/);
    expect(none.stats.find((s) => s.label === 'Topics checked')).toMatchObject({ value: '0', note: 'none checked' });
  });

  it('AI report lists the pages cited', () => {
    expect(find(buildReport(aiReport(aiFixture, '2026-10-08')), 'pages').rows).toStrictEqual([{ url: '[/sewer](https://acmeplumbing.example/sewer)', prompts: 1, volume: 260 }]);
  });

  it('baseline shows what is tracked; a same-data check says when to look again; a real check shows both positions', () => {
    const reports = sampleReports();
    const baseline = buildReport(reports['rank-baseline']);
    expect(find(baseline, 'tracked').rows).toHaveLength(15);
    expect(find(baseline, 'next').text).toMatch(/after November 7, 2026/);

    const same = reports['rank-check-same-data'];
    expect(same.answer).toMatch(/^Nothing to compare\./);
    expect(same.stats.map((s) => s.tone ?? 'neutral')).not.toContain('good');

    const check = buildReport(reports['rank-check']);
    expect(find(check, 'dropped').rows).toStrictEqual([{ keyword: 'emergency plumber', from: '#8', to: 'Left the set', search_volume: 3600, url: '[/](https://acmeplumbing.example/)' }]);
    expect(find(check, 'dropped').columns[2].tones).toStrictEqual({ 'Left the set': 'bad' });
    expect(find(check, 'stats').items.find((s: any) => s.label === 'Moved up')).toMatchObject({ tone: 'good', href: '#up-title' });
  });

  it('rank check lists terms off page one, closest first, and who is #1', () => {
    const spec = sampleReports()['live-rank-check'];
    expect(spec.answer).toBe('acmeplumbing.example is on page one for 3 of 5 search terms checked, 1 of them in the top 3. It isn’t in the top 20 for 1.');
    expect(spec.stats.map((s) => [s.label, s.value])).toStrictEqual([['In the top 3', '1'], ['On page one', '3'], ['Lower', '1'], ['Not found', '1']]);

    const blocks = buildReport(spec);
    expect(find(blocks, 'actions').items).toStrictEqual([
      '“drain cleaning”: #14, with [`/drains`](https://www.acmeplumbing.example/drains). #1 is [rivalplumbing.example](https://rivalplumbing.example/).',
      '“emergency plumber”: not in the top 20. #1 is [rivalplumbing.example](https://rivalplumbing.example/).',
    ]);
    expect(find(blocks, 'results').rows[0]).toStrictEqual({ keyword: 'plumber springfield', position: '#1', url: '[/](https://www.acmeplumbing.example/)', top: '[acmeplumbing.example](https://acmeplumbing.example/), [citydrains.example](https://citydrains.example/), [pipes.example](https://pipes.example/)', features: 'Map results, Questions' });
    expect(find(blocks, 'results').columns[1].tones['Not in top 20']).toBe('bad');
  });

  it('rank check against an earlier one reports each move and what to look at', () => {
    const spec = sampleReports()['live-rank-check-since'];
    expect(spec.answer).toBe('Since September 8, 2026, 2 search terms moved up, 0 moved down and 1 held. 1 entered the top 20 and 1 dropped out.');

    const blocks = buildReport(spec);
    expect(find(blocks, 'actions').items).toStrictEqual(['“emergency plumber” dropped out of the top 20 (was #7). Check that [`/`](https://www.acmeplumbing.example/) still loads.']);
    expect(find(blocks, 'up').rows.map((r: any) => [r.keyword, r.from, r.to, r.change])).toStrictEqual([['drain cleaning', '#18', '#14', 4], ['plumber springfield', '#2', '#1', 1]]);
    expect(find(blocks, 'entered').rows[0]).toMatchObject({ keyword: 'sump pump install', from: 'Not in top 20', to: '#9' });
    expect(find(blocks, 'results')).toBeDefined();
  });

  it('redirect report sorts files from pages, truncates paths and flags pages funneled to one general page', () => {
    const many = { ...redirectFixture, pages: Array.from({ length: 12 }, (_, i) => ({ ...redirectFixture.pages[0], checked_url: `https://staging.acmeplumbing.example/p${i}.pdf` })) };
    const fix = find(buildReport(redirectReport(many, '2026-10-08')), 'fix');
    expect(fix).toMatchObject({ sortable: true, visible: 10 });
    expect(fix.columns.map((c: any) => [c.key, c.format ?? 'text'])).toStrictEqual([['path', 'path'], ['kind', 'text'], ['status', 'badge'], ['domains', 'number']]);
    expect(fix.rows[0].kind).toBe('PDF');

    const hub = 'https://staging.acmeplumbing.example/locations';
    const page = (path: string) => ({ ...redirectFixture.pages[4], checked_url: `https://staging.acmeplumbing.example${path}`, final_url: hub });
    const pages = [page('/north/'), page('/south/'), page('/east/'), page('/locations/')];
    expect(funnels(pages).map((f) => [f.lands, f.from.length])).toStrictEqual([['/locations', 3]]);
    const blocks = buildReport(redirectReport({ ...redirectFixture, pages: [...redirectFixture.pages, ...pages] }, '2026-10-08'));
    expect(find(blocks, 'general-0')).toMatchObject({ type: 'callout', title: '3 old pages land on [`/locations`](https://staging.acmeplumbing.example/locations)' });
  });

  it('redirect report shows the chain when a path takes two or more hops', () => {
    const o = 'https://staging.acmeplumbing.example';
    const hopped = {
      ...redirectFixture.pages[4], checked_url: `${o}/rebate/`, final_url: `${o}/services/rebate`,
      hops: [{ url: `${o}/rebate/`, status: 308 }, { url: `${o}/rebate`, status: 308 }],
    };
    const blocks = buildReport(redirectReport({ ...redirectFixture, pages: [...redirectFixture.pages, hopped] }, '2026-10-08'));
    const table = find(blocks, 'redirecting');
    expect(table.columns.map((c: any) => c.key)).toContain('chain');
    expect(table.rows.find((r: any) => r.path === `[/rebate/](${o}/rebate/)`).chain).toBe('/rebate/ → /rebate → /services/rebate');
    expect(table.rows.find((r: any) => r.path.startsWith('[/about-us/]')).chain).toBeNull();
    expect(find(blocks, 'chains')).toMatchObject({ type: 'callout', title: '1 address takes two or more redirects' });
  });
});

describe('reports show what the check returned', () => {
  it('snapshot names the similar terms behind an opportunity', () => {
    const kw = { ...snapshotFixture.top_keywords.find((k) => k.keyword === 'drain cleaning')!, keyword: 'drain unclogging', position: 15, search_volume: 100 };
    const rows = find(buildReport(snapshotReport({ ...snapshotFixture, top_keywords: [...snapshotFixture.top_keywords, kw] }, '2026-10-08')), 'actions').rows;
    expect(rows.find((r: any) => r.keyword.startsWith('drain cleaning')).keyword).toBe('drain cleaning (also “drain unclogging”)');
  });

  it('gap lists every left-out example', () => {
    const spec = gapReport({ ...gapFixture, excluded_examples: { ...gapFixture.excluded_examples, unrelated: ['zip code finder', 'weather'] } }, '2026-10-08');
    expect(spec.method.find((m) => m.label === 'Filter')?.text).toMatch(/12 unrelated to your work \(like “zip code finder” and “weather”\)/);
  });

  it('local links each listing and shows its reviews', () => {
    const blocks = buildReport(sampleReports()['local-visibility']);
    expect(find(blocks, 'results').rows[0]).toMatchObject({ listing: 'Acme Plumbing · 4.6★ (120)', first: '[Rival Plumbing](https://www.google.com/maps?cid=123) · 4.8★ (312)' });
    expect(find(blocks, 'actions').items[0]).toContain('[Rival Plumbing](https://www.google.com/maps?cid=123) (4.8 stars, 312 reviews)');
  });

  it('AI topics show every top source with its count', () => {
    const row = find(buildReport(sampleReports()['ai-visibility']), 'topics').rows[0];
    expect(row.sources).toBe('[rivalplumbing.example](https://rivalplumbing.example) (30), [forum.example](https://forum.example) (20), [hardware.example](https://hardware.example) (9)');
  });

  it('rank check since names the terms it couldn’t compare', () => {
    const spec = rankReport(rankFixture, '2026-10-08', { ...rankPrevFixture, terms: [...rankPrevFixture.terms, { ...rankPrevFixture.terms[0]!, keyword: 'boiler repair' }] });
    expect(spec.method.find((m) => m.label === 'Compared')?.text).toMatch(/1 term in only one check isn’t compared: “boiler repair”\./);
  });

  it('baseline comparisons list every tracked term', () => {
    const reports = sampleReports();
    for (const name of ['rank-check', 'rank-check-same-data']) {
      expect(find(buildReport(reports[name]!), 'tracked-details')).toMatchObject({ type: 'details' });
    }
    expect(find(buildReport(reports['rank-baseline']!), 'positions')).toBeDefined();
  });

  it('redirect report says why a request failed and lists homepage redirects', () => {
    const blocks = buildReport(sampleReports()['backlink-redirects']);
    expect(find(blocks, 'fix').rows.find((r: any) => r.status === 'No response').error).toBe('fetch failed');
    const home = find(blocks, 'home');
    expect(home.columns.map((c: any) => c.key)).toStrictEqual(['path', 'domains']);
    expect(home.rows).toMatchObject([{ path: '[/blog/2020/03/hello](https://staging.acmeplumbing.example/blog/2020/03/hello)', domains: 3 }]);
  });
});

describe('buildReport', () => {
  const base = {
    kind: 'SEO snapshot', date: '2026-10-08', title: 'T', answer: 'A.', stats: [{ label: 'S', value: 1 }],
    method: [{ label: 'What', text: 'Things.' }], source: 'DataForSEO Labs', cost: 0.0144,
  };

  it('orders kicker, answer, stats, method, actions and sections, then the footer', () => {
    const blocks = buildReport({
      ...base,
      actionsIntro: 'Why these.',
      actions: [{ id: 'actions', type: 'list', items: ['do it'] }],
      sections: [{ id: 's', type: 'text', text: 'section' }],
    });

    expect(blocks.map((b) => b.id)).toStrictEqual(['title', 'answer', 'stats', 'method', 'actions-title', 'actions-intro', 'actions', 's', 'footer']);
    expect(blocks[0]).toStrictEqual({ id: 'title', type: 'heading', level: 1, text: 'T', kicker: 'SEO snapshot · October 8, 2026' });
    expect(find(blocks, 'method-list').items).toStrictEqual(['**What:** Things.']);
    expect(blocks.at(-1)).toStrictEqual({ id: 'footer', type: 'footer', text: 'Data: DataForSEO Labs, October 8, 2026.' });
  });

  it('keeps cost off the page and skips the intro without actions', () => {
    const blocks = buildReport({ ...base, actions: [], actionsIntro: 'Why.', cached: true });
    expect(blocks.at(-1)).toMatchObject({ text: 'Data: DataForSEO Labs, October 8, 2026.' });
    expect(blocks.map((b) => b.id)).not.toContain('actions-intro');
  });

  it('usd', () => {
    expect(usd(0)).toBe('$0');
    expect(usd(0.0276)).toBe('$0.028');
    expect(usd(0.002)).toBe('$0.0020');
  });
});

describe('buildReport empty columns', () => {
  it('drops a table column with no value in any row', async () => {
    const { buildReport } = await import('./report.js');
    const blocks = buildReport({
      kind: 'Test', title: 't', date: '2026-10-09', answer: 'a', stats: [], method: [], source: 's',
      actions: [{ id: 'tbl', type: 'table', columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], rows: [{ a: 1, b: null }, { a: 2, b: '' }] }],
    } as never);
    const table = blocks.find((b) => b.id === 'tbl') as { columns: { key: string }[] };
    expect(table.columns.map((c) => c.key)).toEqual(['a']);
  });
});
