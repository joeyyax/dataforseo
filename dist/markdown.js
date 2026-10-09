import { CALLOUT_LABELS, cellMarkup, glossary, isNumeric, parseInline, withStop } from './inline.js';
/** Escapes characters Markdown would read as markup, HTML or a table cell break. */
function escape(text) {
    return text
        .replace(/[\\`*[\]<>|~]/g, '\\$&')
        .replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (m) => m.replace('_', '\\_'))
        .replace(/&(?=#?\w+;)/g, '&amp;')
        .replace(/\r?\n/g, ' ');
}
function codeSpan(text) {
    const fence = '`'.repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length)) + 1);
    const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
    return `${fence}${pad}${text.replace(/\|/g, '\\|')}${pad}${fence}`;
}
function inline(parts) {
    return parts
        .map((p) => {
        if (p.type === 'text')
            return escape(p.text);
        if (p.type === 'code')
            return codeSpan(p.text);
        if (p.type === 'bold')
            return `**${inline(p.children)}**`;
        return `[${inline(p.children)}](${p.href.replace(/[()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)})`;
    })
        .join('');
}
const md = (text) => inline(parseInline(text)).replace(/^(#{1,6}|[+-]|\d+[.)])(?= |$)/, (m) => m.replace(/[#+.)-]/, '\\$&'));
function stat(s) {
    return `- ${md(s.label)}: **${md(typeof s.value === 'number' ? s.value.toLocaleString('en-US') : s.value)}**${s.note ? ` (${md(s.note)})` : ''}`;
}
function table(head, right, rows) {
    const line = (cells) => `| ${cells.join(' | ')} |`;
    return [line(head), line(right.map((r) => (r ? '---:' : '---'))), ...rows.map(line)].join('\n');
}
/** GitHub-flavored Markdown. The same blocks always give the same output. */
export const toMarkdown = (blocks) => {
    const define = glossary();
    let level = 1;
    const render = (b) => {
        switch (b.type) {
            case 'heading':
                level = b.level ?? 2;
                return `${'#'.repeat(level)} ${md(b.text)}${b.kicker ? `\n\n_${md(b.kicker)}_` : ''}`;
            case 'text':
                return md(b.text);
            case 'stats':
                return b.items.map(stat).join('\n');
            case 'table':
                return table(b.columns.map((c) => md(c.label)), b.columns.map(isNumeric), b.rows.map((r) => b.columns.map((c) => inline(cellMarkup(c, r[c.key])))));
            case 'callout':
                return `> **${md(withStop(b.title ?? CALLOUT_LABELS[b.tone]))}** ${md(b.text)}`;
            case 'list':
                return b.items.map((item, i) => `${b.ordered ? `${i + 1}.` : '-'} ${md(item)}`).join('\n');
            case 'details': {
                const outer = level;
                level = Math.min(outer + 1, 6);
                const out = [`${'#'.repeat(level)} ${md(b.summary)}`, ...b.blocks.map(withTerms)].join('\n\n');
                level = outer;
                return out;
            }
            case 'chart':
                return [
                    ...(b.title ? [`**${md(b.title)}**`] : []),
                    table(['', ...b.series.map((s) => md(s.name))], [false, ...b.series.map(() => true)], b.labels.map((l, i) => [md(l), ...b.series.map((s) => (s.values[i] ?? '').toLocaleString('en-US'))])),
                ].join('\n\n');
            case 'footer':
                return `---\n\n<sub>${md(b.text)}</sub>`;
        }
    };
    const withTerms = (b) => [render(b), ...define(b).map(([term, text]) => `_${md(term)}_: ${md(text)}`)].join('\n\n');
    return `${blocks.map(withTerms).join('\n\n')}\n`;
};
