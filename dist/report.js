/** Kicker, title, answer, stat tiles, method, actions, sections and footer, in that order. */
export function buildReport(spec) {
    const blocks = [
        { id: 'title', type: 'heading', level: 1, text: spec.title, kicker: `${spec.kind} · ${longDate(spec.date)}` },
        { id: 'answer', type: 'text', size: 'lg', text: spec.answer, ...(spec.answerTerms ? { terms: spec.answerTerms } : {}) },
        { id: 'stats', type: 'stats', items: spec.stats },
        {
            id: 'method',
            type: 'details',
            summary: 'How this was measured',
            blocks: [{ id: 'method-list', type: 'list', items: spec.method.map((m) => `**${m.label}:** ${m.text}`) }],
        },
        { id: 'actions-title', type: 'heading', level: 2, text: spec.actionsTitle ?? 'What to do' },
        ...(spec.actionsIntro && spec.actions.length ? [{ id: 'actions-intro', type: 'text', text: spec.actionsIntro }] : []),
        ...(spec.actions.length ? spec.actions : [{ id: 'all-clear', type: 'callout', tone: 'good', text: spec.allClear ?? 'Nothing needs attention.' }]),
        ...(spec.sections ?? []),
    ];
    blocks.push({ id: 'footer', type: 'footer', text: `Data: ${spec.source}, ${longDate(spec.date)}.${spec.note ? ` ${spec.note}` : ''}` });
    // A tile lands on its section's heading when there is one, not the table under it.
    const ids = new Set(blocks.map((b) => b.id));
    const stats = blocks[2];
    stats.items = stats.items.map((s) => (s.href && ids.has(`${s.href.slice(1)}-title`) ? { ...s, href: `${s.href}-title` } : s));
    return blocks;
}
/** Badge tones for every distinct value in one column. */
export function tonesFor(rows, key, tone) {
    const tones = {};
    for (const r of rows) {
        const v = r[key];
        if (v !== null && v !== undefined && v !== '')
            tones[String(v)] = tone(String(v));
    }
    return tones;
}
/** Wraps a URL path in inline code. */
export function code(s) {
    return `\`${s.replace(/`/g, '')}\``;
}
/** `$0`, `$0.0020`, `$0.028`. */
export function usd(n) {
    if (n === 0)
        return '$0';
    return `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`;
}
/** Whole number with US thousands separators. */
export function count(n) {
    return Math.round(Number(n ?? 0)).toLocaleString('en-US');
}
/** "1 search term", "3 search terms". */
export function plural(n, one, many = `${one}s`) {
    return `${count(n)} ${n === 1 ? one : many}`;
}
/** "the one search", "all 3 searches". */
export function every(n, one, many = `${one}s`) {
    return n === 1 ? `the one ${one}` : `all ${plural(n, one, many)}`;
}
/** "once", "3 times". */
export function times(n) {
    return n === 1 ? 'once' : plural(n, 'time');
}
/** "The question", "The 25 questions". */
export function theTop(n, one, many = `${one}s`) {
    return n === 1 ? `The ${one}` : `The ${plural(n, one, many)}`;
}
/** Uppercases the first letter. */
export function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
/** The `YYYY-MM-DD` part of an ISO timestamp. */
export function day(iso) {
    return iso.slice(0, 10);
}
/** `2026-11-08` → "November 8, 2026". */
export function longDate(iso) {
    return new Date(`${day(iso)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
/** 0.123 → "12%"; anything above zero but under 1% reads "under 1%". */
export function percent(share) {
    if (share > 0 && share < 0.005)
        return 'under 1%';
    return `${Math.round(share * 100)}%`;
}
/** "a", "a and b", "a, b and c": no Oxford comma. */
export function series(items) {
    if (items.length <= 1)
        return items.join('');
    return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
