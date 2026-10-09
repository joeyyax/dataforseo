import { DailyLimitError } from './client.js';
import { combine, dailyBudget, sameSite, DEFAULT_LANGUAGE, DEFAULT_LOCATION } from './checks.js';
import { mapLimit, money, normalizeDomain } from './util.js';
const SERP = '/serp/google/organic';
const LIVE = `${SERP}/live/regular`;
/** Search terms `rankCheck` runs before it refuses. */
export const DEFAULT_RANK_MAX_KEYWORDS = 100;
/** Results read per search: Google's page one. */
export const DEFAULT_RANK_DEPTH = 10;
/** USD for the first 10 results of one search. Each further 10 costs 75% of this. */
export const RANK_PRICES = { queue: 0.0006, priority: 0.0012, live: 0.002 };
/** The most `rankCheck` could cost for `terms` searches. DataForSEO bills deeper pages only when Google returns them. */
export function estimateRankCost(terms, mode = 'queue', depth = DEFAULT_RANK_DEPTH) {
    const pages = Math.ceil(depth / 10);
    return money(terms * RANK_PRICES[mode] * (1 + 0.75 * (pages - 1)));
}
/** The domain's best organic result in a SERP result, with the page's other result types and top 3. */
export function parseSerp(result, domain) {
    const organic = (Array.isArray(result?.items) ? result.items : []).filter((i) => i?.type === 'organic');
    const mine = organic.find((i) => sameSite(i.domain ?? i.url, domain));
    const types = Array.isArray(result?.item_types) ? result.item_types : [];
    return {
        position: mine ? Number(mine.rank_group) : null,
        url: mine?.url ?? null,
        title: mine?.title ?? null,
        features: types.filter((t) => t !== 'organic'),
        top_3: organic.slice(0, 3).map((i) => ({ position: Number(i.rank_group), domain: normalizeDomain(String(i.domain ?? i.url ?? '')), url: String(i.url ?? '') })),
    };
}
/** Where a domain ranks on Google today for each search term: one search per term, queued or live. */
export async function rankCheck(client, input, now = Date.now) {
    const keywords = [...new Set((input.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean))];
    const max = input.max_keywords ?? DEFAULT_RANK_MAX_KEYWORDS;
    if (keywords.length > max) {
        throw new Error(`${keywords.length} search terms is more than max_keywords (${max}). Each term is a paid search; raise max_keywords to run them all.`);
    }
    if (!keywords.length)
        throw new Error('Name at least one search term.');
    const depth = input.depth ?? DEFAULT_RANK_DEPTH;
    if (!Number.isInteger(depth) || depth < 10 || depth > 100)
        throw new Error(`depth is ${depth}; use a whole number from 10 to 100.`);
    const domain = normalizeDomain(input.domain);
    const location = input.location ?? DEFAULT_LOCATION;
    const language = input.language ?? DEFAULT_LANGUAGE;
    const device = input.device ?? 'desktop';
    const mode = input.mode ?? 'queue';
    if (!(mode in RANK_PRICES))
        throw new Error(`mode is "${mode}"; use queue, priority or live.`);
    if (mode !== 'live' && !client.queued)
        throw new Error("This client can't queue tasks. Use mode: 'live', or a client from createDataForSeoClient.");
    const task = (keyword) => ({ keyword, location_name: location, language_name: language, device, depth });
    const charges = input.refresh || !client.cached
        ? keywords.map(() => null)
        : await Promise.all(keywords.map((k) => client.cached(LIVE, task(k))));
    const misses = keywords.filter((_, i) => !charges[i]);
    if (misses.length) {
        const estimate = estimateRankCost(misses.length, mode, depth);
        const budget = await dailyBudget(client, now);
        if (budget.left !== null && estimate > budget.left) {
            throw new DailyLimitError(null, LIVE, `This check could cost up to $${estimate.toFixed(4)} and $${budget.left.toFixed(4)} of DataForSEO's daily spend limit ($${budget.limit}) is left. It resets at midnight UTC.`);
        }
        const fresh = mode === 'live'
            ? await mapLimit(misses, 3, (k) => client.live(LIVE, task(k), { refresh: true }))
            : await client.queued(SERP, misses.map(task), { priority: mode === 'priority', pollMs: input.pollMs, timeoutMs: input.timeoutMs });
        let next = 0;
        for (let i = 0; i < charges.length; i++)
            if (!charges[i])
                charges[i] = fresh[next++];
    }
    const terms = keywords.map((keyword, i) => {
        const c = charges[i];
        return { keyword, ...parseSerp(c.result, domain), cost: c.cost, cached: c.cached, fetched_at: c.fetched_at };
    });
    const found = terms.filter((t) => t.position !== null).map((t) => t.position);
    return {
        domain, location, language, device, depth, mode, terms,
        summary: {
            top_3: found.filter((p) => p <= 3).length,
            page_one: found.filter((p) => p <= 10).length,
            lower: found.filter((p) => p > 10).length,
            not_found: terms.length - found.length,
        },
        ...combine(charges, new Date(now()).toISOString()),
    };
}
/** Compares two rank checks for the same location, language and device. A deeper check is cut to the shallower one's depth. */
export function rankDiff(prev, next) {
    if (prev.location !== next.location || prev.language !== next.language || prev.device !== next.device) {
        throw new Error('Compare rank checks with the same location, language and device.');
    }
    const depth = Math.min(prev.depth, next.depth);
    const within = (p) => (p !== null && p <= depth ? p : null);
    const before = new Map(prev.terms.map((t) => [t.keyword, t]));
    const after = new Set(next.terms.map((t) => t.keyword));
    const diff = { gained: [], lost: [], improved: [], declined: [], unchanged: [], depth, not_compared: [] };
    for (const t of next.terms) {
        const old = before.get(t.keyword);
        if (!old) {
            diff.not_compared.push(t.keyword);
            continue;
        }
        const from = within(old.position);
        const to = within(t.position);
        const move = { keyword: t.keyword, from, to, change: from !== null && to !== null ? from - to : null, url: to !== null ? t.url : old.url };
        if (from === null && to !== null)
            diff.gained.push(move);
        else if (from !== null && to === null)
            diff.lost.push(move);
        else if (move.change > 0)
            diff.improved.push(move);
        else if (move.change < 0)
            diff.declined.push(move);
        else
            diff.unchanged.push(move);
    }
    diff.not_compared.push(...prev.terms.filter((t) => !after.has(t.keyword)).map((t) => t.keyword));
    diff.gained.sort((a, b) => a.to - b.to);
    diff.lost.sort((a, b) => a.from - b.from);
    diff.improved.sort((a, b) => b.change - a.change);
    diff.declined.sort((a, b) => a.change - b.change);
    return diff;
}
