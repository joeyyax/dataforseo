import { capitalize, code, count, day, every, longDate, percent, plural, series, theTop, times, tonesFor, type Block, type MethodLine, type ReportSpec, type StatItem, type TableColumn } from './report.js';
import {
  GAP_MAX_POSITION, MAPS_DEPTH, matchesBusiness, sameSite,
  type AiResult, type BaselineResult, type ClassifiedKeyword, type GapResult, type GapTerm, type LocalResult, type MapsListing, type RelevanceInput, type SnapshotResult,
} from './checks.js';
import type { BacklinkRedirectsResult, PathCheck } from './redirects.js';
import type { KeywordMove, RankedKeyword } from './snapshots.js';
import { rankDiff, type RankCheckResult, type RankMove } from './rank.js';
import { mentions, type TermKind } from './relevance.js';

const ACTIONS = 5;
const VISIBLE_ROWS = 10;
/** Days between ranking checks worth running: DataForSEO Labs refreshes rankings about monthly. */
const CHECK_INTERVAL_DAYS = 30;

const PLATFORM_LABEL: Record<string, string> = { chat_gpt: 'ChatGPT', google: 'Google AI Overviews' };
/** Below this many answers a topic's top sources are noise. */
const MIN_TOPIC_ANSWERS = 10;

/** One definition per term, so every report explains it the same way. */
export const GLOSSARY = {
  position: 'Where the page shows in Google’s results for that search. #1 is the first result; #1 to #10 is page one.',
  searches: 'Average Google searches a month for the term across the United States.',
  visits: 'An estimate of clicks from Google: each term’s searches a month times the share of clicks its position usually gets. It isn’t from analytics.',
  pageOne: 'Positions #1 to #10, the first page of results. Few people click past it.',
  topThree: 'Positions #1 to #3, which get most of the clicks.',
  navigational: 'A search for one specific business, brand, venue or event by name.',
  intent: 'What the searcher is likely after, as DataForSEO classifies it: an answer, a specific place or site, options to compare or a way to act.',
  mention: 'The AI answer names the organization in its text, with or without a link.',
  citation: 'The AI answer links a page on the site as one of its sources.',
  linkingSites: 'Other websites with at least one link to that address. Each site counts once.',
  mapsTop3: 'The three listings Google shows with the map at the top of local results. Most taps go to these.',
  aiSearches: 'DataForSEO’s estimate of how often people ask AI tools that question in a month.',
  features: 'Other things Google shows on the results page, such as ads, maps and answer boxes. They push the regular results down.',
} as const;

function quote(s: string): string {
  return `“${s}”`;
}

function labsWhere(location: string, language: string): string {
  return `Google in ${location === 'United States' ? 'the United States' : location}, ${language}. Rankings are national, not what someone searching from one city sees.`;
}

const LABS_SOURCE = 'DataForSEO Labs, which estimates rankings, searches and visits from its own regular Google crawls.';

/** Position chips stay neutral; only a missing position is flagged. */
function positionTone(value: string): 'neutral' | 'bad' {
  const n = Number(value.replace('#', ''));
  return !Number.isFinite(n) || n <= 0 ? 'bad' : 'neutral';
}

function pos(n: number | null | undefined): string | null {
  return n ? `#${n}` : null;
}

const KIND_LABEL: Record<TermKind, string> = {
  brand: 'Your name',
  topic: '',
  elsewhere: 'Another area',
  'other-name': 'Another name or place',
  unrelated: 'Unrelated',
  unsorted: 'Not sorted',
};

function about(k: { kind: TermKind; theme?: string }): string {
  return k.kind === 'topic' ? (k.theme ?? 'Your work') : KIND_LABEL[k.kind];
}

const offTopic = (k: { kind: TermKind }) => k.kind === 'other-name' || k.kind === 'unrelated' || k.kind === 'elsewhere';

/** Plain-language description of how terms were sorted, or that they weren't. */
function sortingLine(r: RelevanceInput, name: string): MethodLine {
  const names = [r.brand, ...r.aliases].filter(Boolean).map((n) => quote(n as string));
  if (!r.topics.length) {
    return {
      label: 'Sorting',
      text: `Terms aren’t sorted by topic in this report, so none are marked as about your work or unrelated. Terms with ${names.length ? series(names) : `the ${name} name`} count as your name.`,
    };
  }
  const topics = r.topics.map((t) => `${t.label} (${t.words.join(', ')})`).join('; ');
  return {
    label: 'Sorting',
    text: `A term is about your work when it contains a topic word: ${topics}. Terms with ${names.length ? series(names) : 'your domain name'} count as your name.`
      + (r.area.length ? ` A term naming a US state, a large US city or Canada outside ${series(r.area.map(titleCase))} counts as another area.` : '')
      + ' A search for another business or place counts as another name. Everything else is unrelated.',
  };
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function sum(list: { etv: number }[]): number {
  return list.reduce((s, k) => s + k.etv, 0);
}

// SEO snapshot

function termRows(list: ClassifiedKeyword[]) {
  return list.map((k) => ({ keyword: k.keyword, about: about(k), position: `#${k.position}`, search_volume: k.search_volume, etv: Math.round(k.etv), url: k.url }));
}

function termTable(id: string, list: ClassifiedKeyword[], opts: { about?: boolean; visible?: number } = {}): Block {
  const rows = termRows(list);
  const columns: TableColumn[] = [
    { key: 'keyword', label: 'Search term' },
    ...(opts.about === false ? [] : [{ key: 'about', label: 'About' } as TableColumn]),
    { key: 'position', label: 'Position', format: 'badge', tones: tonesFor(rows, 'position', positionTone), help: GLOSSARY.position },
    { key: 'search_volume', label: 'Searches a month', format: 'number', help: GLOSSARY.searches },
    { key: 'etv', label: 'Est. visits', format: 'number', help: GLOSSARY.visits },
    { key: 'url', label: 'Page', format: 'path' },
  ];
  const visible = opts.visible ?? VISIBLE_ROWS;
  return { id, type: 'table', columns, rows: rows.map(({ about: a, ...rest }) => (opts.about === false ? rest : { about: a, ...rest })), sortable: rows.length > visible, ...(rows.length > visible ? { visible } : {}) };
}

/**
 * Topic terms at #4 to #20, one per page, since the fix is the page.
 * Searches for a service or an answer come first; searches for a specific place or site come last.
 */
export function snapshotOpportunities(keywords: ClassifiedKeyword[]): (ClassifiedKeyword & { similar: number })[] {
  const nav = (k: ClassifiedKeyword) => (k.intent === 'navigational' ? 1 : 0);
  const candidates = keywords
    .filter((k) => (k.kind === 'topic' || k.kind === 'unsorted') && k.position >= 4 && k.position <= 20)
    .sort((a, b) => nav(a) - nav(b) || b.search_volume - a.search_volume);
  const byPage = new Map<string, ClassifiedKeyword & { similar: number }>();
  for (const k of candidates) {
    const seen = byPage.get(k.url);
    if (seen) seen.similar++;
    else byPage.set(k.url, { ...k, similar: 0 });
  }
  return [...byPage.values()].slice(0, ACTIONS);
}

const LOOKING_FOR: Record<string, string> = {
  informational: 'An answer',
  navigational: 'A specific place or site',
  commercial: 'Options to compare',
  transactional: 'To buy, book or sign up',
};

/** Report for `seoSnapshot`. */
export function snapshotReport(r: SnapshotResult, date: string): ReportSpec {
  const kw = r.top_keywords;
  const name = r.relevance.brand ?? r.domain;
  const sorted = r.relevance.topics.length > 0;
  const off = kw.filter(offTopic);
  const pulled = sum(kw);
  const offShare = pulled ? sum(off) / pulled : 0;
  const p = r.positions;
  const pageOne = p.top_3 + p['4_10'];
  const opportunities = snapshotOpportunities(kw);
  const examples = [...off].sort((a, b) => b.search_volume - a.search_volume).slice(0, 2).map((k) => quote(k.keyword));

  const answer = r.keywords_total
    ? `${r.domain} gets about ${count(r.est_monthly_visits)} estimated visits a month from Google, across ${plural(r.keywords_total, 'search term')}. ${count(pageOne)} of those terms are on page one.`
      + (sorted && off.length ? ` ${percent(offShare)} of the visits from the top ${count(kw.length)} terms come from searches that aren’t about ${name}’s work, like ${series(examples)}.` : '')
    : `${r.domain} isn’t in Google’s top 100 for any search term.`;

  const stats: StatItem[] = [
    { label: 'Est. visits a month', value: count(r.est_monthly_visits), note: 'from Google, not analytics', href: '#top-terms' },
    { label: 'Search terms', value: count(r.keywords_total), note: 'the site shows up for', href: '#positions' },
    { label: 'On page one', value: count(pageOne), note: `positions #1 to #10, ${count(p.top_3)} in the top 3`, href: '#positions' },
    ...(sorted ? [{ label: 'Visits not about your work', value: percent(offShare), note: `of the top ${count(kw.length)} terms’ visits`, ...(off.length ? { href: '#off-topic' } : {}) } as StatItem] : []),
  ];

  const opportunityRows = opportunities.map((k) => ({
    keyword: k.similar ? `${k.keyword} (+${count(k.similar)} similar)` : k.keyword,
    about: about(k),
    wants: k.intent ? (LOOKING_FOR[k.intent] ?? null) : null,
    position: `#${k.position}`,
    search_volume: k.search_volume,
    url: k.url,
  }));
  const actions: Block[] = opportunities.length ? [{
    id: 'actions',
    type: 'table',
    columns: [
      { key: 'keyword', label: 'Search term' },
      ...(sorted ? [{ key: 'about', label: 'Topic' } as TableColumn] : []),
      { key: 'wants', label: 'Searcher wants', help: GLOSSARY.intent },
      { key: 'position', label: 'Position', format: 'badge', tones: tonesFor(opportunityRows, 'position', positionTone), help: GLOSSARY.position },
      { key: 'search_volume', label: 'Searches a month', format: 'number', help: GLOSSARY.searches },
      { key: 'url', label: 'Page to improve', format: 'path' },
    ],
    rows: opportunityRows.map(({ about: a, ...rest }) => (sorted ? { about: a, ...rest } : rest)),
  }] : [];

  const bands = [
    { band: '#1 to #3', meaning: 'Top of page one. Most clicks go here.', terms: p.top_3 },
    { band: '#4 to #10', meaning: 'Rest of page one.', terms: p['4_10'] },
    { band: '#11 to #20', meaning: 'Page two. Few people look this far.', terms: p['11_20'] },
    { band: '#21 to #100', meaning: 'Page three or later. Almost no clicks.', terms: p['21_100'] },
  ];
  const deep = r.keywords_total ? p['21_100'] / r.keywords_total : 0;

  return {
    kind: 'SEO snapshot',
    date,
    title: `${r.domain} on Google`,
    answer,
    answerTerms: { 'estimated visits': GLOSSARY.visits, 'page one': GLOSSARY.pageOne },
    stats,
    method: [
      { label: 'What', text: `Every search term ${r.domain} shows up for in Google’s top 100, with its position and estimated visits. The tables list the ${count(kw.length)} terms that bring the most visits.` },
      { label: 'Where', text: labsWhere(r.location, r.language) },
      { label: 'When', text: `Data pulled ${longDate(r.fetched_at)}.` },
      { label: 'Source', text: LABS_SOURCE },
      sortingLine(r.relevance, name),
      { label: 'Not measured', text: 'Actual visits, which only Google Search Console or analytics can show, and searches outside Google.' },
    ],
    actions,
    actionsIntro: opportunities.length
      ? `Search terms about ${name}’s work where ${r.domain} is on page one or two but outside the top 3, one per page. The top 3 get most of the clicks. Searches for a service or an answer come first, then the most searched.`
      : undefined,
    allClear: sorted
      ? `Every term about ${name}’s work in the top ${count(kw.length)} is in the top 3 or below page two.`
      : `None of the top ${count(kw.length)} terms are at #4 to #20.`,
    sections: [
      ...(sorted && off.length ? [
        { id: 'off-topic-title', type: 'heading', level: 2, text: 'Searches that aren’t about your work' } as Block,
        {
          id: 'off-topic-note',
          type: 'text',
          text: `${count(off.length)} of the top ${count(kw.length)} terms bring about ${count(sum(off))} estimated visits a month (${percent(offShare)}). They’re searches for another business or place, another area or something unrelated. People making them rarely want what ${r.domain} offers, so the visit total overstates the traffic that matters. They need no work.`,
        } as Block,
        termTable('off-topic', [...off].sort((a, b) => b.etv - a.etv), { visible: 5 }),
      ] : []),
      ...(r.keywords_total ? [
        { id: 'positions-title', type: 'heading', level: 2, text: 'Rankings by position' } as Block,
        {
          id: 'positions-note',
          type: 'text',
          text: `${percent(deep)} of the ${count(r.keywords_total)} terms are on page three or later, where almost nobody clicks. Most visits come from page one.`,
        } as Block,
        {
          id: 'positions',
          type: 'table',
          columns: [
            { key: 'band', label: 'Position', help: GLOSSARY.position },
            { key: 'meaning', label: 'What it means' },
            { key: 'terms', label: 'Search terms', format: 'bar' },
          ],
          rows: bands,
        } as Block,
      ] : []),
      ...(kw.length ? [
        { id: 'top-terms-title', type: 'heading', level: 2, text: 'Top search terms' } as Block,
        { id: 'top-terms-note', type: 'text', text: `The ${count(kw.length)} terms that bring the most estimated visits.` } as Block,
        termTable('top-terms', kw, { about: sorted || kw.some((k) => k.kind !== 'unsorted') }),
        { id: 'top-pages-title', type: 'heading', level: 2, text: 'Top pages' } as Block,
        { id: 'top-pages-note', type: 'text', text: `Pages ranked by the estimated visits those ${count(kw.length)} terms bring them.` } as Block,
        {
          id: 'top-pages',
          type: 'table',
          columns: [
            { key: 'url', label: 'Page', format: 'path' },
            { key: 'keywords', label: 'Search terms', format: 'number' },
            { key: 'etv', label: 'Est. visits', format: 'number', help: GLOSSARY.visits },
          ],
          rows: r.top_pages,
          ...(r.top_pages.length > VISIBLE_ROWS ? { visible: VISIBLE_ROWS } : {}),
        } as Block,
      ] : []),
    ],
    source: 'DataForSEO Labs',
    cost: r.cost,
    cached: r.cached,
  };
}

// Competitor gap

function best(g: GapTerm): string {
  const c = g.competitors[0];
  return c ? `${c.domain} is #${c.position}` : 'a competitor is on page one';
}

function gapTable(id: string, list: GapTerm[], weak: boolean, sorted: boolean): Block {
  const rows = list.map((g) => ({
    keyword: g.keyword,
    theme: g.theme ?? null,
    search_volume: g.search_volume,
    them: g.competitors.map((c) => `${c.domain} #${c.position}`).join(', '),
    ...(weak ? { you: pos(g.position), url: g.url } : {}),
  }));
  const columns: TableColumn[] = [
    { key: 'keyword', label: 'Search term' },
    ...(sorted ? [{ key: 'theme', label: 'Topic' } as TableColumn] : []),
    { key: 'search_volume', label: 'Searches a month', format: 'number', help: GLOSSARY.searches },
    { key: 'them', label: weak ? 'Ahead of you' : 'Who ranks', help: GLOSSARY.position },
    ...(weak ? [
      { key: 'you', label: 'You', format: 'badge', tones: tonesFor(rows, 'you', positionTone) } as TableColumn,
      { key: 'url', label: 'Your page', format: 'path' } as TableColumn,
    ] : []),
  ];
  return {
    id, type: 'table', columns,
    rows: rows.map(({ theme, ...rest }) => (sorted ? { theme, ...rest } : rest)),
    sortable: rows.length > VISIBLE_ROWS,
    ...(rows.length > VISIBLE_ROWS ? { visible: VISIBLE_ROWS } : {}),
  };
}

/** Report for `competitorGap`. */
export function gapReport(r: GapResult, date: string): ReportSpec {
  const name = r.relevance.brand ?? r.domain;
  const sorted = r.relevance.topics.length > 0;
  const weak = r.gaps.filter((g) => g.gap === 'weak');
  const missing = r.gaps.filter((g) => g.gap === 'missing');
  const scope = sorted ? 'about your work' : '';
  const competitorNames = r.competitors.map((c) => c.domain);
  const area = r.relevance.area;
  const local = area.length ? r.gaps.filter((g) => area.some((a) => mentions(g.keyword, a))) : [];
  const localLine = area.length
    ? ` ${count(local.length)} of them name your area, with ${count(local.reduce((s, g) => s + g.search_volume, 0))} searches a month. The rest are national searches, where national organizations usually lead.`
    : '';
  const distinct = r.gaps.length + r.excluded.brand + r.excluded.other_name + r.excluded.elsewhere + r.excluded.unrelated + r.excluded.ahead;

  const themes = new Map<string, GapTerm[]>();
  for (const g of r.gaps) themes.set(g.theme ?? 'Not sorted', [...(themes.get(g.theme ?? 'Not sorted') ?? []), g]);
  const themeRows = [...themes.entries()].map(([theme, list]) => {
    const leaders = new Map<string, number>();
    for (const g of list) if (g.competitors[0]) leaders.set(g.competitors[0].domain, (leaders.get(g.competitors[0].domain) ?? 0) + 1);
    const leader = [...leaders.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      theme,
      terms: list.length,
      search_volume: list.reduce((s, g) => s + g.search_volume, 0),
      weak: list.filter((g) => g.gap === 'weak').length,
      missing: list.filter((g) => g.gap === 'missing').length,
      leader,
    };
  }).sort((a, b) => b.search_volume - a.search_volume);

  const ex = r.excluded;
  const left = [
    ex.other_name ? `${plural(ex.other_name, 'term')} naming a competitor or another business${r.excluded_examples.other_name.length ? ` (like ${quote(r.excluded_examples.other_name[0] as string)})` : ''}` : '',
    ex.elsewhere ? `${count(ex.elsewhere)} about another area${r.excluded_examples.elsewhere.length ? ` (like ${quote(r.excluded_examples.elsewhere[0] as string)})` : ''}` : '',
    ex.unrelated ? `${count(ex.unrelated)} unrelated to your work${r.excluded_examples.unrelated.length ? ` (like ${quote(r.excluded_examples.unrelated[0] as string)})` : ''}` : '',
    ex.brand ? `${count(ex.brand)} with your own name` : '',
    ex.ahead ? `${count(ex.ahead)} where you already rank ahead` : '',
  ].filter(Boolean);

  // One action per topic: its biggest search and its closest win, so near-duplicate terms don't crowd the list.
  const actions = themeRows.slice(0, ACTIONS).map((t) => {
    const list = themes.get(t.theme) ?? [];
    const biggest = list[0] as GapTerm;
    const closest = list.filter((g) => g.gap === 'weak').sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || b.search_volume - a.search_volume)[0];
    const you = (g: GapTerm) => (g.gap === 'weak' ? `you’re #${g.position} with ${code(g.url ?? '/')}` : 'you’re not in the top 100');
    const lead = `**${t.theme}:** ${plural(t.terms, 'term')}, ${count(t.search_volume)} searches a month. The biggest is ${quote(biggest.keyword)}: ${best(biggest)} and ${you(biggest)}.`;
    return closest && closest !== biggest ? `${lead} Your best position is on ${quote(closest.keyword)}: ${best(closest)} and ${you(closest)}.` : lead;
  });

  return {
    kind: 'Competitor gap',
    date,
    title: `${r.domain} against competitors on Google`,
    answer: r.gaps.length
      ? `${series(competitorNames)} ${competitorNames.length === 1 ? 'is' : 'are'} on Google’s page one for ${plural(r.gaps.length, 'search term')}${scope ? ` ${scope}` : ''} where ${r.domain} ranks lower: ${count(weak.length)} where it’s further down and ${count(missing.length)} where it isn’t in the top 100. Those terms get about ${count(r.gap_search_volume)} searches a month.${localLine}`
      : `${series(competitorNames)} ${competitorNames.length === 1 ? 'isn’t' : 'aren’t'} on page one ahead of ${r.domain} for any search term${scope ? ` ${scope}` : ''}.`,
    answerTerms: { "page one": GLOSSARY.pageOne },
    stats: [
      { label: 'Behind a competitor', value: count(weak.length), note: 'both rank, the competitor higher', ...(weak.length ? { href: '#weak' } : {}) },
      { label: 'Not ranking', value: count(missing.length), note: 'you’re not in the top 100', ...(missing.length ? { href: '#missing' } : {}) },
      { label: 'Searches a month', value: count(r.gap_search_volume), note: 'across those terms', ...(r.gaps.length ? { href: '#themes' } : {}) },
      { label: 'Competitors', value: count(r.competitors.length), note: 'compared', href: '#competitors' },
    ],
    method: [
      { label: 'What', text: `Search terms where at least one competitor is on page one (#1 to #${r.max_position}) and ${r.domain} is lower or not in the top 100.` },
      { label: 'Competitors', text: `${series(competitorNames)}.` },
      { label: 'Where', text: labsWhere(r.location, r.language) },
      { label: 'When', text: `Data pulled ${longDate(r.fetched_at)}.` },
      { label: 'Source', text: LABS_SOURCE },
      sortingLine(r.relevance, name),
      {
        label: 'Filter',
        text: `For each competitor, up to ${count(r.limit)} of its most-searched page-one terms that you also rank for, and up to ${count(r.limit)} that you don’t. Terms shared between competitors count once, which leaves ${plural(distinct, 'term')}. ${count(r.gaps.length)} are in this report.${left.length ? ` Left out: ${series(left)}.` : ''}`,
      },
    ],
    actions: actions.length ? [{ id: 'actions', type: 'list', ordered: true, items: actions }] : [],
    actionsIntro: actions.length
      ? `One line per topic, most searched first. Where you rank, improving the page listed is the usual fix. Where you don’t, it’s usually a page that answers the search.`
      : undefined,
    allClear: `No competitor is on page one ahead of ${r.domain} for the terms checked: up to ${count(r.limit)} of each competitor’s most-searched page-one terms${scope ? `, ${scope}` : ''}.`,
    sections: [
      ...(themeRows.length ? [
        { id: 'themes-title', type: 'heading', level: 2, text: sorted ? 'By topic' : 'All terms' } as Block,
        {
          id: 'themes',
          type: 'table',
          columns: [
            { key: 'theme', label: 'Topic' },
            { key: 'search_volume', label: 'Searches a month', format: 'bar', help: GLOSSARY.searches },
            { key: 'weak', label: 'Behind', format: 'number' },
            { key: 'missing', label: 'Not ranking', format: 'number' },
            { key: 'leader', label: 'Ahead most often', format: 'code' },
          ],
          rows: themeRows.map(({ terms: _t, ...rest }) => rest),
        } as Block,
      ] : []),
      ...(weak.length ? [
        { id: 'weak-title', type: 'heading', level: 2, text: 'Behind a competitor' } as Block,
        { id: 'weak-note', type: 'text', text: `Both sites rank and the competitor is higher. These are usually the quickest to improve, since Google already connects ${r.domain} to the search.` } as Block,
        gapTable('weak', weak, true, sorted),
      ] : []),
      ...(missing.length ? [
        { id: 'missing-title', type: 'heading', level: 2, text: 'Not ranking' } as Block,
        { id: 'missing-note', type: 'text', text: `A competitor is on page one and ${r.domain} isn’t in the top 100, usually because no page covers the search.` } as Block,
        gapTable('missing', missing, false, sorted),
      ] : []),
      { id: 'competitors-title', type: 'heading', level: 2, text: 'By competitor' },
      {
        id: 'competitors',
        type: 'table',
        columns: [
          { key: 'domain', label: 'Competitor', format: 'code' },
          { key: 'weak', label: 'Ahead of you', format: 'number' },
          { key: 'missing', label: 'Only they rank', format: 'number' },
          {
            key: 'all', label: 'Only they rank, any term', format: 'number',
            help: `Every term where they’re on page one and ${r.domain} isn’t in the top 100, before terms unrelated to your work are left out.`,
          },
        ],
        rows: r.competitors.map((c) => ({
          domain: c.domain,
          weak: weak.filter((g) => g.competitors.some((x) => x.domain === c.domain)).length,
          missing: missing.filter((g) => g.competitors.some((x) => x.domain === c.domain)).length,
          all: c.missing_total,
        })),
      },
    ],
    source: 'DataForSEO Labs',
    cost: r.cost,
    cached: r.cached,
  };
}

// Local visibility

function describeListing(l: MapsListing): string {
  const rating = l.rating !== null ? `${l.rating} stars${l.reviews !== null ? `, ${plural(l.reviews, 'review')}` : ''}` : 'no rating';
  return `${l.title} (${rating})`;
}

/** "Austin,Texas,United States" → "Austin, Texas, United States". */
function place(location: string): string {
  return location.replace(/,(?=\S)/g, ', ');
}

/** Report for `localVisibility`. */
export function localReport(r: LocalResult, date: string): ReportSpec {
  const yours = (l: MapsListing) => matchesBusiness(l, r.business, r.domain);
  const actions = r.results.filter((x) => x.position === null || x.position > 3).map((x) => {
    const leaders = x.top_3.filter((l) => !yours(l)).map(describeListing);
    const top = leaders.length ? ` The top 3 are ${series(leaders)}.` : '';
    return x.position === null
      ? `${quote(x.keyword)}: not in the top ${MAPS_DEPTH}.${top}`
      : `${quote(x.keyword)}: ${x.listing?.title ?? 'your listing'} is #${x.position}.${top}`;
  });
  const sweeps = r.results.filter((x) => x.top_3.length === 3 && x.top_3.every(yours));
  const { top_3, lower, not_found } = r.summary;
  const rows = r.results.map((x) => ({
    keyword: x.keyword,
    you: x.position === null ? 'Not found' : `#${x.position}`,
    listing: x.listing ? `${x.listing.title}${x.listing.rating !== null ? ` · ${x.listing.rating}★` : ''}` : null,
    first: x.top_3[0]?.title ?? null,
    second: x.top_3[1]?.title ?? null,
    third: x.top_3[2]?.title ?? null,
  }));
  const where = place(r.location);
  return {
    kind: 'Local visibility',
    date,
    title: `${r.business} on Google Maps`,
    answer: `${r.business} is in the Google Maps top 3 for ${count(top_3)} of ${plural(r.results.length, 'search', 'searches')} checked in ${where}.`
      + (sweeps.length ? ` For ${series(sweeps.map((x) => quote(x.keyword)))}, all three top spots are its own locations.` : ''),
    answerTerms: { 'Google Maps top 3': GLOSSARY.mapsTop3 },
    stats: [
      { label: 'In the top 3', value: count(top_3), note: `of ${plural(r.results.length, 'search', 'searches')} checked`, href: '#results' },
      { label: 'Listed lower', value: count(lower), note: `#4 to #${MAPS_DEPTH}`, tone: lower ? 'warn' : 'neutral', href: '#results' },
      { label: 'Not found', value: count(not_found), note: `outside the top ${MAPS_DEPTH}`, tone: not_found ? 'bad' : 'neutral', href: '#results' },
    ],
    method: [
      { label: 'What', text: `Where ${r.business} shows in Google Maps for ${series(r.results.map((x) => quote(x.keyword)))}, and who holds the top 3.` },
      { label: 'Where', text: `Searched from the center of ${where}, in ${r.language}. Maps results change with the searcher’s location, so this is one snapshot.` },
      { label: 'When', text: `Searched ${longDate(r.fetched_at)}.` },
      { label: 'Matching', text: `A listing counts as yours when its website is ${r.domain ?? 'your domain'} or its name matches ${quote(r.business)}. Your best-placed listing is shown.` },
      { label: 'Depth', text: `The top ${MAPS_DEPTH} Maps results for each search.` },
      { label: 'Source', text: 'DataForSEO, which runs the search on Google Maps and returns the listings.' },
    ],
    actions: actions.length ? [{ id: 'actions', type: 'list', items: actions }] : [],
    actionsIntro: actions.length ? 'Searches where you’re not in the top 3, and who is. Google ranks Maps listings by relevance to the search, distance from the searcher and prominence, which includes reviews.' : undefined,
    allClear: `${r.business} is in the top 3 for ${every(r.results.length, 'search', 'searches')} checked.`,
    sections: [
      { id: 'results-title', type: 'heading', level: 2, text: 'Results by search' },
      {
        id: 'results',
        type: 'table',
        columns: [
          { key: 'keyword', label: 'Search' },
          { key: 'you', label: 'You', format: 'badge', tones: tonesFor(rows, 'you', positionTone), help: `Your best Maps position for the search, out of the top ${MAPS_DEPTH}.` },
          { key: 'listing', label: 'Your listing' },
          { key: 'first', label: '#1' },
          { key: 'second', label: '#2' },
          { key: 'third', label: '#3' },
        ],
        rows,
      },
    ],
    source: `DataForSEO Google Maps (${where}, ${r.language})`,
    cost: r.cost,
    cached: r.cached,
  };
}

// AI visibility

/** First path on the domain for each cited page, most prompts first. */
function citedPages(r: AiResult): { url: string; prompts: number; volume: number }[] {
  const pages = new Map<string, { url: string; prompts: number; volume: number }>();
  for (const p of r.top_prompts) {
    if (!p.url) continue;
    const path = pathOf(p.url) || '/';
    const page = pages.get(path) ?? { url: path, prompts: 0, volume: 0 };
    page.prompts++;
    page.volume += p.ai_search_volume;
    pages.set(path, page);
  }
  return [...pages.values()].sort((a, b) => b.volume - a.volume || b.prompts - a.prompts);
}

/** One line per topic, or one line for all of them when the same sites lead each. */
function topicActions(uncited: AiResult['topics'], domain: string): string[] {
  const leaders = (t: AiResult['topics'][number]) => t.top_sources.slice(0, 3).map((s) => s.domain);
  const withSources = uncited.filter((t) => t.top_sources.length);
  const same = withSources.length > 1 && withSources.every((t) => leaders(t).join() === leaders(withSources[0] as AiResult['topics'][number]).join());
  const lines = same
    ? [`For questions about ${series(withSources.map((t) => quote(t.keyword)))}, AI answers cite ${series(leaders(withSources[0] as AiResult['topics'][number]))} most. ${domain} isn’t a top source for any of them.`]
    : withSources.map((t) => `For questions about ${quote(t.keyword)}, AI answers cite ${series(leaders(t))} most. ${domain} isn’t in the top ${count(t.top_sources.length)}.`);
  return [...lines, ...uncited.filter((t) => !t.top_sources.length).map((t) => `AI answers about ${quote(t.keyword)} cite no sources in the sample, so there’s no site to compare with.`)];
}

/** Report for `aiVisibility`. */
export function aiReport(r: AiResult, date: string): ReportSpec {
  const brand = r.brand ?? r.domain;
  const platforms = [...new Set([...Object.keys(r.citations.by_platform), ...Object.keys(r.brand_mentions?.by_platform ?? {})])]
    .sort((a, b) => (PLATFORM_LABEL[a] ?? a).localeCompare(PLATFORM_LABEL[b] ?? b));
  const mentionsOn = (k: string) => r.brand_mentions?.by_platform[k] ?? 0;
  const citesOn = (k: string) => r.citations.by_platform[k] ?? 0;
  const mentions = r.brand_mentions?.total ?? 0;
  const nothing = r.citations.total === 0 && mentions === 0;
  // Named far more often than linked: under one citation per 20 mentions.
  const named = r.brand ? platforms.filter((k) => mentionsOn(k) >= 20 && citesOn(k) * 20 < mentionsOn(k)) : [];
  const linkLine = (k: string) => (citesOn(k) ? `links ${r.domain} in only ${count(citesOn(k))}` : `never links ${r.domain}`);
  const pages = citedPages(r);
  const uncited = r.topics.filter((t) => !t.cited && t.mentions >= MIN_TOPIC_ANSWERS);
  const cited = r.topics.filter((t) => t.cited && t.mentions >= MIN_TOPIC_ANSWERS);

  const actions = [
    ...named.map((k) => `${PLATFORM_LABEL[k] ?? k} names ${brand} in ${plural(mentionsOn(k), 'answer')} but ${linkLine(k)}.`),
    ...topicActions(uncited, r.domain),
  ];
  if (nothing) actions.unshift(`Publish plain answers to the questions people ask about ${brand}.`);

  const answer = r.brand
    ? `AI answers in DataForSEO’s sample link ${r.domain} as a source ${times(r.citations.total)} and name ${r.brand} ${times(mentions)}.`
    : `AI answers in DataForSEO’s sample link ${r.domain} as a source ${times(r.citations.total)}.`;
  const insight = named.length === 1
    ? ` ${PLATFORM_LABEL[named[0] as string] ?? named[0]} names it ${count(mentionsOn(named[0] as string))} times but ${linkLine(named[0] as string)}.`
    : named.length ? ` ${series(named.map((k) => PLATFORM_LABEL[k] ?? k))} name it far more often than they link the site.` : '';

  const topicsLine = r.topics.length
    ? `For questions containing ${series(r.topics.map((t) => quote(t.keyword)))}, the sites the answers cite most.`
    : 'None checked, so there’s no topic-by-topic view.';

  return {
    kind: 'AI visibility',
    date,
    title: `${brand} in AI answers`,
    answer: answer + insight,
    stats: [
      { label: 'Citations', value: count(r.citations.total), note: `answers linking ${r.domain}`, href: '#platforms' },
      ...(r.brand ? [{ label: 'Mentions', value: count(mentions), note: `answers naming ${r.brand}`, href: '#platforms' } as StatItem] : []),
      {
        label: 'Topics checked',
        value: count(r.topics.length),
        note: !r.topics.length ? 'none checked' : `${r.domain} a top source in ${cited.length ? count(cited.length) : 'none'}`,
        href: r.topics.length ? '#topics' : '#method',
      },
      ...(r.top_prompts.length ? [{ label: 'Pages cited', value: count(pages.length), note: `in ${plural(r.top_prompts.length, 'top question')}`, ...(pages.length ? { href: '#pages' } : {}) } as StatItem] : []),
    ],
    method: [
      { label: 'What', text: r.brand ? `How often AI answers name ${r.brand} (a mention) and link a page on ${r.domain} as a source (a citation).` : `How often AI answers link a page on ${r.domain} as a source (a citation).` },
      { label: 'Where', text: 'ChatGPT and Google AI Overviews, United States, English.' },
      { label: 'When', text: `Data pulled ${longDate(r.fetched_at)}.` },
      { label: 'Source', text: 'DataForSEO LLM Mentions, a large sample of AI answers to real questions. Counts are answers in that sample, not every conversation, and the same question can get a different answer each time.' },
      ...(r.brand ? [{ label: 'Name matching', text: `An answer counts as a mention when it contains ${quote(r.brand)}. A name made of common words also matches generic phrases, so the mention count can run high.` }] : []),
      { label: 'Topics', text: topicsLine },
      { label: 'Questions', text: r.top_prompts.length ? `${theTop(r.top_prompts.length, 'question')} with the most AI searches a month whose answers cite ${r.domain}.` : 'Not checked.' },
    ],
    actions: actions.length ? [{ id: 'actions', type: 'list', items: actions }] : [],
    actionsIntro: actions.length && !nothing ? 'AI tools tend to link pages that answer one question plainly.' : undefined,
    allClear: !r.topics.length
      ? `${r.domain} is cited and named on every platform checked. No topics were checked, so this says nothing about specific questions.`
      : cited.length === r.topics.length
        ? `AI answers cite ${r.domain} for ${every(r.topics.length, 'topic')} checked: ${series(r.topics.map((t) => quote(t.keyword)))}.`
        : `AI answers cite ${r.domain} for ${count(cited.length)} of ${plural(r.topics.length, 'topic')} checked. The rest had too few answers in the sample to judge.`,
    sections: [
      { id: 'platforms-title', type: 'heading', level: 2, text: 'By platform' },
      {
        id: 'platforms-note',
        type: 'text',
        text: r.brand ? 'A mention is the name in the answer’s text. A citation is a link to the site among its sources. Either can happen without the other.' : 'A citation is a link to the site among the answer’s sources.',
        terms: { mention: GLOSSARY.mention, citation: GLOSSARY.citation },
      },
      {
        id: 'platforms',
        type: 'table',
        columns: [
          { key: 'platform', label: 'Platform' },
          ...(r.brand ? [{ key: 'mentions', label: 'Mentions', format: 'number', help: GLOSSARY.mention } as TableColumn] : []),
          { key: 'citations', label: 'Citations', format: 'number', help: GLOSSARY.citation },
        ],
        rows: platforms.map((k) => ({ platform: PLATFORM_LABEL[k] ?? k, ...(r.brand ? { mentions: mentionsOn(k) } : {}), citations: citesOn(k) })),
      },
      ...(r.topics.length ? [
        { id: 'topics-title', type: 'heading', level: 2, text: 'Topics checked' } as Block,
        { id: 'topics-note', type: 'text', text: `The sites AI answers cite most often for questions containing each topic. “No” means ${r.domain} isn’t among those top sites, not that it’s never cited. “Too few answers” means under ${count(MIN_TOPIC_ANSWERS)} answers in the sample.` } as Block,
        {
          id: 'topics',
          type: 'table',
          columns: [
            { key: 'keyword', label: 'Topic' },
            { key: 'cited', label: `${r.domain} a top source`, format: 'badge', tones: { Yes: 'good', No: 'warn', 'Too few answers': 'neutral' } },
            { key: 'mentions', label: 'Answers found', format: 'number', help: 'Answers in the sample to questions that contain the topic.' },
            { key: 'sources', label: 'Most cited sites' },
          ],
          rows: r.topics.map((t) => ({
            keyword: t.keyword,
            cited: t.mentions < MIN_TOPIC_ANSWERS ? 'Too few answers' : t.cited ? 'Yes' : 'No',
            mentions: t.mentions,
            sources: t.mentions < MIN_TOPIC_ANSWERS ? null : t.top_sources.slice(0, 3).map((s) => s.domain).join(', ') || null,
          })),
        } as Block,
      ] : []),
      ...(pages.length ? [
        { id: 'pages-title', type: 'heading', level: 2, text: 'Pages AI cites' } as Block,
        { id: 'pages-note', type: 'text', text: `From ${theTop(r.top_prompts.length, 'question').toLowerCase()} with the most AI searches a month whose answers link ${r.domain}.` } as Block,
        {
          id: 'pages',
          type: 'table',
          columns: [
            { key: 'url', label: 'Page', format: 'path' },
            { key: 'prompts', label: 'Questions', format: 'number' },
            { key: 'volume', label: 'AI searches a month', format: 'number', help: GLOSSARY.aiSearches },
          ],
          rows: pages,
        } as Block,
      ] : []),
      ...(r.top_prompts.length ? [
        { id: 'prompts-title', type: 'heading', level: 2, text: 'Answers that cite the site' } as Block,
        {
          id: 'prompts',
          type: 'table',
          columns: [
            { key: 'question', label: 'Question' },
            { key: 'platform', label: 'Where' },
            { key: 'volume', label: 'AI searches a month', format: 'number', help: GLOSSARY.aiSearches },
            { key: 'url', label: 'Page cited', format: 'path' },
          ],
          rows: r.top_prompts.map((p) => ({ question: p.question, platform: PLATFORM_LABEL[p.platform] ?? p.platform, volume: p.ai_search_volume, url: p.url ? pathOf(p.url) || '/' : null })),
          ...(r.top_prompts.length > VISIBLE_ROWS ? { visible: VISIBLE_ROWS } : {}),
        } as Block,
      ] : []),
    ],
    source: 'DataForSEO LLM Mentions',
    cost: r.cost,
    cached: r.cached,
  };
}

// Rank baseline and check

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

function trackedTable(id: string, keywords: RankedKeyword[]): Block {
  return termTable(id, keywords.map((k) => ({ ...k, kind: 'unsorted' as const })), { about: false });
}

/** Report for `rankBaseline`: the baseline itself, a same-data notice or the changes since. */
export function baselineReport(r: BaselineResult, date: string): ReportSpec {
  const source = 'DataForSEO Labs';
  const next = longDate(addDays(r.fetched_at, CHECK_INTERVAL_DAYS));
  const top3 = r.keywords.filter((k) => k.position <= 3).length;
  const pageOne = r.keywords.filter((k) => k.position <= 10).length;
  const common: MethodLine[] = [
    { label: 'Where', text: labsWhere(r.location, r.language) },
    { label: 'Source', text: `${LABS_SOURCE} It refreshes rankings about monthly.` },
  ];
  const trackedSection = (title: string): Block[] => [
    { id: 'tracked-title', type: 'heading', level: 2, text: title },
    { id: 'tracked-note', type: 'text', text: `The ${plural(r.keywords.length, 'search term')} that bring ${r.domain} the most estimated visits, with the position each had on ${longDate(r.fetched_at)}.` },
    trackedTable('tracked', r.keywords),
  ];

  if (!r.compared_to) {
    return {
      kind: 'Ranking baseline',
      date,
      title: `${r.domain} rankings: the starting point`,
      answer: `This baseline saves the ${plural(r.keywords_tracked, 'search term')} that bring ${r.domain} the most estimated visits, with each term’s position on ${longDate(r.fetched_at)}. Later ranking checks compare against it.`,
      answerTerms: { 'estimated visits': GLOSSARY.visits, position: GLOSSARY.position },
      stats: [
        { label: 'Terms tracked', value: count(r.keywords_tracked), href: '#tracked' },
        { label: 'In the top 3', value: count(top3), note: 'positions #1 to #3', href: '#tracked' },
        { label: 'On page one', value: count(pageOne), note: 'positions #1 to #10', href: '#tracked' },
        { label: 'Est. visits a month', value: count(sum(r.keywords)), note: 'from these terms', href: '#tracked' },
      ],
      method: [
        { label: 'What', text: `The ${plural(r.keywords_tracked, 'search term')} with the most estimated visits, up to ${count(r.limit)}, with position, searches a month and the ranking page. ${r.domain} shows up for ${plural(r.keywords_total, 'term')} in all.` },
        { label: 'When', text: `Data pulled ${longDate(r.fetched_at)}.` },
        ...common,
      ],
      actionsTitle: 'Next step',
      actions: [{ id: 'next', type: 'text', text: `Run the ranking check after ${next}, once DataForSEO has fresh rankings, then monthly. If the site is relaunching, run one after launch too.` }],
      sections: trackedSection('What’s tracked'),
      source,
      cost: r.cost,
      cached: r.cached,
    };
  }

  const prior = r.compared_to;
  const since = longDate(prior.created);

  if (prior.same_data || !r.diff) {
    return {
      kind: 'Ranking baseline',
      date,
      title: `${r.domain} rankings: nothing to compare until ${next}`,
      answer: `Nothing to compare. This check got the same rankings data as the ${since} baseline, so no position could change.`,
      stats: [
        { label: 'Terms tracked', value: count(r.keywords_tracked), href: '#next' },
        { label: 'Baseline', value: longDate(prior.created), note: 'the list this check compares with', href: '#method' },
      ],
      method: [
        { label: 'What', text: `Compares the position of each tracked term with the baseline saved ${since}.` },
        { label: 'When', text: `Data pulled ${longDate(r.fetched_at)}, the same pull as the baseline.` },
        ...common,
      ],
      actionsTitle: 'Next step',
      actions: [{ id: 'next', type: 'text', text: `Run the check again after ${next}, once DataForSEO has refreshed its rankings. The tracked terms are on the baseline page.` }],
      sections: [],
      source,
      cost: r.cost,
      cached: r.cached,
    };
  }

  const diff = r.diff;
  const trimNote = prior.trimmed
    ? ` The baseline held ${plural(prior.keywords_tracked, 'term')} and this check ${count(r.keywords_tracked)}, so both were cut to the top ${count(prior.compared_terms)} to match.`
    : '';
  const moveTable = (id: string, list: KeywordMove[]): Block => {
    const rows = list.map((m) => ({ keyword: m.keyword, from: pos(m.from), to: m.to === null ? 'Left the set' : `#${m.to}`, search_volume: m.search_volume, url: m.url }));
    return {
      id,
      type: 'table',
      columns: [
        { key: 'keyword', label: 'Search term' },
        { key: 'from', label: 'Was', align: 'right', help: GLOSSARY.position },
        { key: 'to', label: 'Now', format: 'badge', tones: tonesFor(rows, 'to', (v) => (v === 'Left the set' ? 'bad' : positionTone(v))) },
        { key: 'search_volume', label: 'Searches a month', format: 'number', help: GLOSSARY.searches },
        { key: 'url', label: 'Page', format: 'path' },
      ],
      rows,
      sortable: rows.length > VISIBLE_ROWS,
      ...(rows.length > VISIBLE_ROWS ? { visible: VISIBLE_ROWS } : {}),
    };
  };
  const section = (id: string, title: string, note: string, list: KeywordMove[]): Block[] => (list.length ? [
    { id: `${id}-title`, type: 'heading', level: 2, text: `${title} (${count(list.length)})` },
    { id: `${id}-note`, type: 'text', text: note },
    moveTable(id, list),
  ] : []);
  const actions = [
    ...diff.lost.map((m) => `${quote(m.keyword)} left the tracked set (was #${m.from}, ${count(m.search_volume)} searches a month). Check that ${code(m.url)} still loads.`),
    ...diff.declined.filter((m) => (m.to ?? 0) - (m.from ?? 0) >= 3)
      .map((m) => `${quote(m.keyword)} fell from #${m.from} to #${m.to} (${count(m.search_volume)} searches a month).`),
  ].slice(0, ACTIONS);
  const toned = (n: number, tone: 'good' | 'warn' | 'bad') => (n ? tone : 'neutral');
  return {
    kind: 'Ranking baseline',
    date,
    title: `${r.domain} rankings since ${since}`,
    answer: `Since ${since}, ${plural(diff.improved.length, 'tracked term')} moved up, ${count(diff.declined.length)} moved down and ${count(diff.unchanged)} held their position. ${count(diff.lost.length)} left the tracked set and ${count(diff.gained.length)} joined it.`,
    stats: [
      { label: 'Moved up', value: count(diff.improved.length), tone: toned(diff.improved.length, 'good'), href: '#up' },
      { label: 'Moved down', value: count(diff.declined.length), tone: toned(diff.declined.length, 'warn'), href: '#down' },
      { label: 'Left the set', value: count(diff.lost.length), tone: toned(diff.lost.length, 'bad'), href: '#dropped' },
      { label: 'Joined the set', value: count(diff.gained.length), tone: toned(diff.gained.length, 'good'), href: '#new' },
    ],
    method: [
      { label: 'What', text: `Positions of the top ${count(prior.compared_terms)} terms by estimated visits, compared with the baseline saved ${since}. A term that leaves the top ${count(prior.compared_terms)} counts as left, even if it still ranks lower.${trimNote}` },
      { label: 'When', text: `Data pulled ${longDate(r.fetched_at)}; baseline data pulled ${longDate(prior.fetched_at)}.` },
      ...common,
    ],
    actions: actions.length ? [{ id: 'actions', type: 'list', items: actions }] : [],
    actionsIntro: actions.length ? 'Terms that left the tracked set, then terms that fell three or more places.' : undefined,
    allClear: `No tracked term left the set or fell three or more places since ${since}. Next check after ${next}.`,
    sections: [
      ...section('dropped', 'Left the tracked set', `In the top ${count(prior.compared_terms)} by estimated visits on ${since}, but not on ${longDate(r.fetched_at)}.`, diff.lost),
      ...section('down', 'Moved down', 'A higher number is a lower spot on the page.', diff.declined),
      ...section('up', 'Moved up', `Higher on the page than on ${since}.`, diff.improved),
      ...section('new', 'Joined the tracked set', `Not in the top ${count(prior.compared_terms)} by estimated visits on ${since}.`, diff.gained),
    ],
    source,
    cost: r.cost,
    cached: r.cached,
  };
}

// Rank check

const FEATURE_LABEL: Record<string, string> = {
  featured_snippet: 'Featured snippet', local_pack: 'Map results', map: 'Map', people_also_ask: 'Questions', ai_overview: 'AI Overview',
  paid: 'Ads', video: 'Videos', images: 'Images', top_stories: 'News', shopping: 'Shopping', knowledge_graph: 'Knowledge panel',
};

function featureLabel(type: string): string {
  return FEATURE_LABEL[type] ?? capitalize(type.replace(/_/g, ' '));
}

/** Report for `rankCheck`, or for the changes since `prev` when given. */
export function rankReport(r: RankCheckResult, date: string, prev?: RankCheckResult): ReportSpec {
  const n = r.terms.length;
  const notIn = (depth: number) => `Not in top ${depth}`;
  const days = [...new Set(r.terms.map((t) => day(t.fetched_at)))].sort();
  const searched = days.length > 1 ? `Searched between ${longDate(days[0])} and ${longDate(days.at(-1)!)}.` : `Searched ${longDate(r.fetched_at)}.`;
  const rows = r.terms.map((t) => ({
    keyword: t.keyword,
    position: t.position === null ? notIn(r.depth) : `#${t.position}`,
    url: t.url ? pathOf(t.url) || '/' : null,
    first: t.top_3[0]?.domain ?? null,
    features: t.features.map(featureLabel).join(', ') || null,
  }));
  const results: Block[] = [
    { id: 'results-title', type: 'heading', level: 2, text: 'Results by search' },
    {
      id: 'results',
      type: 'table',
      columns: [
        { key: 'keyword', label: 'Search term' },
        { key: 'position', label: 'Position', format: 'badge', tones: tonesFor(rows, 'position', positionTone), help: GLOSSARY.position },
        { key: 'url', label: 'Page', format: 'path' },
        { key: 'first', label: '#1' },
        { key: 'features', label: 'Also on the page', help: GLOSSARY.features },
      ],
      rows,
      sortable: rows.length > VISIBLE_ROWS,
      ...(rows.length > VISIBLE_ROWS ? { visible: VISIBLE_ROWS } : {}),
    },
  ];
  const method: MethodLine[] = [
    { label: 'What', text: `Where ${r.domain} ranks in Google’s regular results for ${n > 10 ? plural(n, 'search term') : series(r.terms.map((t) => quote(t.keyword)))}.` },
    { label: 'Where', text: `Google in ${r.location === 'United States' ? 'the United States' : place(r.location)}, ${r.language}, on ${r.device === 'mobile' ? 'a phone' : 'a desktop computer'}. Results vary by place and device, so this is one view.` },
    { label: 'When', text: searched },
    { label: 'Matching', text: `A result counts when it’s on ${r.domain} or one of its subdomains. Its best result is shown; ads and map listings don’t count.` },
    { label: 'Depth', text: `The top ${r.depth} results for each search.` },
    { label: 'Source', text: 'DataForSEO, which runs each search on Google and returns the results.' },
  ];
  const base = { kind: 'Rank check', date, source: `DataForSEO Google results (${place(r.location)}, ${r.language}, ${r.device})`, cost: r.cost, cached: r.cached };

  if (!prev) {
    const { top_3, page_one, lower, not_found } = r.summary;
    const misses = [
      ...r.terms.filter((t) => t.position !== null && t.position > 10).sort((a, b) => a.position! - b.position!),
      ...r.terms.filter((t) => t.position === null),
    ];
    const actions = misses.slice(0, ACTIONS).map((t) => {
      const first = t.top_3[0] ? ` #1 is ${t.top_3[0].domain}.` : '';
      return t.position === null
        ? `${quote(t.keyword)}: not in the top ${r.depth}.${first}`
        : `${quote(t.keyword)}: #${t.position}, with ${code(pathOf(t.url) || '/')}.${first}`;
    });
    return {
      ...base,
      title: `${r.domain} on Google`,
      answer: `${r.domain} is on page one for ${count(page_one)} of ${plural(n, 'search term')} checked, ${count(top_3)} of them in the top 3.`
        + (not_found ? ` It isn’t in the top ${r.depth} for ${count(not_found)}.` : ''),
      answerTerms: { 'page one': GLOSSARY.pageOne, 'top 3': GLOSSARY.topThree },
      stats: [
        { label: 'In the top 3', value: count(top_3), note: `of ${plural(n, 'search term')}`, href: '#results' },
        { label: 'On page one', value: count(page_one), note: 'positions #1 to #10', href: '#results' },
        ...(r.depth > 10 ? [{ label: 'Lower', value: count(lower), note: `#11 to #${r.depth}`, tone: lower ? 'warn' : 'neutral', href: '#results' } as StatItem] : []),
        { label: 'Not found', value: count(not_found), note: `outside the top ${r.depth}`, tone: not_found ? 'bad' : 'neutral', href: '#results' },
      ],
      method,
      actions: actions.length ? [{ id: 'actions', type: 'list', items: actions }] : [],
      actionsIntro: actions.length
        ? `Search terms where ${r.domain} isn’t on page one, closest first.${misses.length > ACTIONS ? ` ${count(misses.length - ACTIONS)} more are in Results by search.` : ''}`
        : undefined,
      allClear: `${r.domain} is on page one for ${every(n, 'search term')} checked.`,
      sections: results,
    };
  }

  const diff = rankDiff(prev, r);
  const since = longDate(prev.fetched_at);
  const compared = diff.improved.length + diff.declined.length + diff.unchanged.length + diff.gained.length + diff.lost.length;
  const moveTable = (id: string, list: RankMove[]): Block => {
    const moves = list.map((m) => ({ keyword: m.keyword, from: m.from === null ? notIn(diff.depth) : `#${m.from}`, to: m.to === null ? notIn(diff.depth) : `#${m.to}`, change: m.change, url: m.url ? pathOf(m.url) || '/' : null }));
    return {
      id,
      type: 'table',
      columns: [
        { key: 'keyword', label: 'Search term' },
        { key: 'from', label: 'Was', align: 'right', help: GLOSSARY.position },
        { key: 'to', label: 'Now', format: 'badge', tones: tonesFor(moves, 'to', positionTone) },
        { key: 'change', label: 'Places', format: 'number', help: 'Places gained. A negative number is places lost.' },
        { key: 'url', label: 'Page', format: 'path' },
      ],
      rows: moves,
      sortable: moves.length > VISIBLE_ROWS,
      ...(moves.length > VISIBLE_ROWS ? { visible: VISIBLE_ROWS } : {}),
    };
  };
  const section = (id: string, title: string, note: string, list: RankMove[]): Block[] => (list.length ? [
    { id: `${id}-title`, type: 'heading', level: 2, text: `${title} (${count(list.length)})` },
    { id: `${id}-note`, type: 'text', text: note },
    moveTable(id, list),
  ] : []);
  const actions = [
    ...diff.lost.map((m) => `${quote(m.keyword)} dropped out of the top ${diff.depth} (was #${m.from}). Check that ${code(pathOf(m.url) || '/')} still loads.`),
    ...diff.declined.filter((m) => m.change! <= -3).map((m) => `${quote(m.keyword)} fell from #${m.from} to #${m.to}.`),
  ];
  const tile = (label: string, list: RankMove[], tone: 'good' | 'warn' | 'bad', id: string, note?: string): StatItem => ({
    label, value: count(list.length), ...(note ? { note } : {}), tone: list.length ? tone : 'neutral', ...(list.length ? { href: `#${id}` } : {}),
  });
  const notes: MethodLine[] = [{
    label: 'Compared',
    text: `With the check from ${since}, for the ${plural(compared, 'search term')} in both.`
      + (prev.depth !== r.depth ? ` One check read deeper, so both are cut to the top ${diff.depth}.` : '')
      + (diff.not_compared.length ? ` ${plural(diff.not_compared.length, 'term')} in only one check ${diff.not_compared.length === 1 ? 'isn’t' : 'aren’t'} compared.` : ''),
  }];
  return {
    ...base,
    title: `${r.domain} on Google since ${since}`,
    answer: `Since ${since}, ${plural(diff.improved.length, 'search term')} moved up, ${count(diff.declined.length)} moved down and ${count(diff.unchanged.length)} held. `
      + `${count(diff.gained.length)} entered the top ${diff.depth} and ${count(diff.lost.length)} dropped out.`,
    stats: [
      tile('Moved up', diff.improved, 'good', 'up'),
      tile('Moved down', diff.declined, 'warn', 'down'),
      tile('Entered', diff.gained, 'good', 'entered', `the top ${diff.depth}`),
      tile('Dropped out', diff.lost, 'bad', 'dropped', `of the top ${diff.depth}`),
    ],
    method: [...method, ...notes],
    actions: actions.length ? [{ id: 'actions', type: 'list', items: actions.slice(0, ACTIONS) }] : [],
    actionsIntro: actions.length ? 'Terms that dropped out, then terms that fell three or more places.' : undefined,
    allClear: `No search term dropped out of the top ${diff.depth} or fell three or more places since ${since}.`,
    sections: [
      ...section('dropped', 'Dropped out', `In the top ${diff.depth} on ${since}, not now.`, diff.lost),
      ...section('down', 'Moved down', 'A higher number is a lower spot on the page.', diff.declined),
      ...section('up', 'Moved up', `Higher on the page than on ${since}.`, diff.improved),
      ...section('entered', 'Entered', `Not in the top ${diff.depth} on ${since}.`, diff.gained),
      ...results,
    ],
  };
}

// Migration check

function pathOf(url: string | null): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** "/a → /b → /c" when a check took two or more redirects, else null. */
export function chain(p: PathCheck): string | null {
  if (!p.hops || p.hops.length < 2) return null;
  return [...p.hops.map((h) => pathOf(h.url) || '/'), pathOf(p.final_url) || '/'].join(' → ');
}

function fileKind(path: string): string {
  const ext = path.split('?')[0]?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!ext || ext === 'html' || ext === 'htm' || ext === 'php') return 'Page';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return 'Image';
  if (ext === 'pdf') return 'PDF';
  return 'File';
}

/** Several old paths landing on one general page, so each lost its specific match. */
export function funnels(pages: PathCheck[], min = 3): { lands: string; from: PathCheck[] }[] {
  const byLanding = new Map<string, PathCheck[]>();
  for (const p of pages) {
    const lands = pathOf(p.final_url);
    if (!lands || lands === '/') continue;
    byLanding.set(lands, [...(byLanding.get(lands) ?? []), p]);
  }
  const trim = (s: string) => s.replace(/\/+$/, '');
  return [...byLanding.entries()]
    .map(([lands, from]) => ({ lands, from: from.filter((p) => trim(pathOf(p.checked_url)) !== trim(lands)) }))
    .filter((f) => f.from.length >= min)
    .sort((a, b) => b.from.length - a.from.length);
}

/** Report for `backlinkRedirects`: a migration check, or a broken link check when the origin is the live site. */
export function redirectReport(r: BacklinkRedirectsResult, date: string): ReportSpec {
  const fix = r.pages.filter((p) => p.verdict === '404' || p.verdict === 'other');
  const gated = r.pages.filter((p) => p.verdict === 'gated');
  const redirecting = r.pages.filter((p) => p.verdict === 'redirect-ok');
  const unchanged = r.pages.filter((p) => p.verdict === 'ok');
  const homeRedirects = redirecting.filter((p) => p.home_redirect);
  const general = funnels(redirecting);
  const brokenDomains = fix.reduce((s, p) => s + p.referring_domains, 0);
  const brokenPages = fix.filter((p) => fileKind(pathOf(p.checked_url)) === 'Page');
  const origin = r.new_origin.replace(/\/+$/, '');
  // Checked against its own live site, nothing has migrated: these links fail today.
  const live = sameSite(new URL(r.new_origin).hostname, r.domain);

  const pathTable = (id: string, list: PathCheck[], landing: boolean, visible = VISIBLE_ROWS): Block => {
    const showChain = list.some((p) => (p.hops?.length ?? 0) >= 2);
    const rows = list.map((p) => ({
      path: pathOf(p.checked_url),
      kind: fileKind(pathOf(p.checked_url)),
      ...(landing ? { lands: pathOf(p.final_url) || null } : { status: p.final_status !== null ? String(p.final_status) : 'No response' }),
      ...(showChain ? { chain: chain(p) } : {}),
      domains: p.referring_domains,
    }));
    return {
      id,
      type: 'table',
      columns: [
        { key: 'path', label: 'Old address', format: 'path' },
        ...(landing ? [] : [{ key: 'kind', label: 'Type' } as TableColumn]),
        landing
          ? { key: 'lands', label: 'Lands on', format: 'path' }
          : { key: 'status', label: 'Result', format: 'badge', tones: tonesFor(rows, 'status', () => 'neutral'), help: '404 means page not found. Any other number is an error the server returned.' },
        ...(showChain ? [{ key: 'chain', label: 'Redirect chain', help: 'Every address the request passed through, when it took two or more redirects.' } as TableColumn] : []),
        { key: 'domains', label: 'Linking sites', format: 'number', help: GLOSSARY.linkingSites },
      ],
      rows: rows.map(({ kind, ...rest }) => (landing ? rest : { ...rest, kind })),
      sortable: rows.length > visible,
      ...(rows.length > visible ? { visible } : {}),
    };
  };
  const chained = [...fix, ...redirecting].filter((p) => (p.hops?.length ?? 0) >= 2);

  return {
    kind: live ? 'Broken link check' : 'Migration check',
    date,
    title: live ? `${r.domain} links that fail today` : `${r.domain} links on the new site`,
    answer: fix.length
      ? `${plural(fix.length, live ? 'address' : 'old address', live ? 'addresses' : 'old addresses')} that other sites link to ${fix.length === 1 ? 'fails' : 'fail'} on ${live ? `the live site, ${origin}` : origin}`
        + `${brokenPages.length === fix.length ? '' : `, ${count(brokenPages.length)} of them pages and the rest files`}. Counted per address, they have ${plural(brokenDomains, 'linking site')}.`
      : `Every address other sites link to resolves on ${origin}.`,
    answerTerms: { 'linking site': GLOSSARY.linkingSites, 'linking sites': GLOSSARY.linkingSites },
    stats: [
      { label: 'Broken', value: count(fix.length), note: plural(brokenDomains, 'linking site'), tone: fix.length ? 'bad' : 'good', ...(fix.length ? { href: '#fix' } : {}) },
      { label: 'Redirecting', value: count(redirecting.length), note: 'land on a live page', ...(redirecting.length ? { href: '#redirecting' } : {}) },
      { label: 'Unchanged', value: count(unchanged.length), note: 'same address, still live', ...(unchanged.length ? { href: '#unchanged' } : {}) },
      ...(gated.length ? [{ label: 'Behind a login', value: count(gated.length), note: 'couldn’t be checked', tone: 'warn', href: '#gated' } as StatItem] : []),
    ],
    method: [
      { label: 'What', text: `The ${count(r.old_urls)} old ${r.domain} addresses with the most linking sites${r.total_pages_with_backlinks ? `, of ${count(r.total_pages_with_backlinks)} that have any` : ''}. Variants that differ only by http, www, subdomain or tracking tags count as one, which leaves ${plural(r.checked, 'address', 'addresses')}.` },
      { label: 'How', text: `Each address is requested on ${origin} and followed through any redirects to where it ends up.` },
      { label: 'Results', text: 'Broken: ends on a missing page or an error. Redirecting: forwards to a live page. Unchanged: same address, still live. Behind a login: hit a sign-in page, so it couldn’t be checked.' },
      { label: 'When', text: `Links counted ${longDate(r.fetched_at)}; addresses checked ${longDate(`${date}T12:00:00Z`)}.` },
      { label: 'Source', text: 'DataForSEO Backlinks for the linked addresses and their linking sites. The checks run directly against the site.' },
    ],
    actionsTitle: live ? 'Fix' : 'Fix before launch',
    actions: fix.length ? [pathTable('fix', fix, false)] : [],
    actionsIntro: fix.length
      ? `Each needs a redirect to its closest match${live ? '' : ' on the new site'}, starting with the most linked. Links to a missing page pass no search value, and visitors who follow them land on an error.`
      : undefined,
    allClear: `${capitalize(every(r.checked, 'linked address', 'linked addresses'))} ${r.checked === 1 ? 'lands' : 'land'} on a live page.`,
    sections: [
      ...(homeRedirects.length ? [
        { id: 'home-redirects', type: 'callout', tone: 'warn', title: 'Sent to the homepage', text: `${plural(homeRedirects.length, 'inner page')} ${homeRedirects.length === 1 ? 'redirects' : 'redirect'} to the homepage, which Google treats like a missing page. Point ${homeRedirects.length === 1 ? 'it' : 'each'} at its closest match.` } as Block,
      ] : []),
      ...(chained.length ? [{
        id: 'chains',
        type: 'callout',
        tone: 'info',
        title: `${plural(chained.length, 'address', 'addresses')} ${chained.length === 1 ? 'takes' : 'take'} two or more redirects`,
        text: `Point ${chained.length === 1 ? 'it' : 'each'} straight at where it ends up, so visitors and Google take one step. For example, ${chain(chained[0] as PathCheck)}.`,
      } as Block] : []),
      ...general.slice(0, 3).map((g, i): Block => ({
        id: `general-${i}`,
        type: 'callout',
        tone: 'info',
        title: `${plural(g.from.length, 'old page')} land on ${code(g.lands)}`,
        text: `If the new site has a closer page for any of them, point it there: ${series(g.from.slice(0, 4).map((p) => code(pathOf(p.checked_url))))}${g.from.length > 4 ? ` and ${count(g.from.length - 4)} more` : ''}.`,
      })),
      ...(gated.length ? [
        { id: 'gated-title', type: 'heading', level: 2, text: 'Behind a login' } as Block,
        { id: 'gated-note', type: 'text', text: live ? 'These hit a sign-in page, so they couldn’t be checked.' : 'These hit a sign-in page, so they couldn’t be checked. Recheck once the site is public.' } as Block,
        pathTable('gated', gated, true),
      ] : []),
      ...(redirecting.length ? [
        { id: 'redirecting-title', type: 'heading', level: 2, text: 'Redirecting' } as Block,
        { id: 'redirecting-note', type: 'text', text: 'Old addresses that forward to a live page. Check each lands somewhere a visitor would expect.' } as Block,
        pathTable('redirecting', redirecting, true, 5),
      ] : []),
      ...(unchanged.length ? [
        { id: 'unchanged-title', type: 'heading', level: 2, text: 'Unchanged' } as Block,
        { ...pathTable('unchanged', unchanged, true, 5), columns: [{ key: 'path', label: 'Address', format: 'path' }, { key: 'domains', label: 'Linking sites', format: 'number', help: GLOSSARY.linkingSites }] } as Block,
      ] : []),
    ],
    source: 'DataForSEO Backlinks',
    cost: r.cost,
    cached: r.cached,
  };
}
