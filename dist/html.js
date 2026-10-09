import { CALLOUT_LABELS, cellMarkup, glossary, isNumeric, parseInline, plainText, safeHref, withStop } from './inline.js';
function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
function inline(parts) {
    return parts
        .map((p) => {
        if (p.type === 'text')
            return escapeHtml(p.text);
        if (p.type === 'code')
            return `<code>${escapeHtml(p.text)}</code>`;
        if (p.type === 'bold')
            return `<strong>${inline(p.children)}</strong>`;
        return `<a href="${escapeHtml(p.href)}" rel="noopener">${inline(p.children)}</a>`;
    })
        .join('');
}
const html = (text) => inline(parseInline(text));
const id = (b) => (b.id ? ` id="${escapeHtml(b.id)}"` : '');
const tone = (t) => (t && t !== 'neutral' ? ` dfs-${t}` : '');
function stat(s) {
    const v = html(typeof s.value === 'number' ? s.value.toLocaleString('en-US') : s.value);
    const value = s.href && safeHref(s.href) ? `<a href="${escapeHtml(s.href)}">${v}</a>` : v;
    return `<div class="dfs-stat${tone(s.tone)}"><dt>${html(s.label)}</dt><dd class="dfs-value">${value}</dd>${s.note ? `<dd class="dfs-note">${html(s.note)}</dd>` : ''}</div>`;
}
function cell(b, c, r) {
    const v = r[c.key];
    let body = inline(cellMarkup(c, v));
    if (c.format === 'badge' && body)
        body = `<span class="dfs-badge${tone(c.tones?.[String(v)])}">${body}</span>`;
    if (c.format === 'bar' && typeof v === 'number') {
        const max = Math.max(...b.rows.map((row) => Number(row[c.key]) || 0));
        body = `<span class="dfs-bar" aria-hidden="true" style="--w:${max ? Math.round((v / max) * 100) : 0}"></span>${body}`;
    }
    return `<td${isNumeric(c) ? ' class="dfs-num"' : ''}>${body}</td>`;
}
function table(b) {
    const head = b.columns.map((c) => `<th scope="col"${isNumeric(c) ? ' class="dfs-num"' : ''}>${html(c.label)}</th>`).join('');
    const rows = b.rows.map((r) => `<tr>${b.columns.map((c) => cell(b, c, r)).join('')}</tr>`).join('\n');
    return `<div class="dfs-table"${id(b)} tabindex="0"><table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table></div>`;
}
function render(b, define) {
    const out = (() => {
        switch (b.type) {
            case 'heading': {
                const h = `<h${b.level ?? 2}${b.kicker ? '' : id(b)}>${html(b.text)}</h${b.level ?? 2}>`;
                return b.kicker ? `<hgroup${id(b)}><p class="dfs-kicker">${html(b.kicker)}</p>${h}</hgroup>` : h;
            }
            case 'text':
                return `<p${id(b)}${b.size && b.size !== 'base' ? ` class="dfs-${b.size}"` : ''}>${html(b.text)}</p>`;
            case 'stats':
                return `<dl class="dfs-stats"${id(b)}>\n${b.items.map(stat).join('\n')}\n</dl>`;
            case 'table':
                return table(b);
            case 'callout':
                return `<aside class="dfs-callout${tone(b.tone)}"${id(b)}><p><strong>${html(withStop(b.title ?? CALLOUT_LABELS[b.tone]))}</strong> ${html(b.text)}</p></aside>`;
            case 'list': {
                const tag = b.ordered ? 'ol' : 'ul';
                return `<${tag}${id(b)}>\n${b.items.map((i) => `<li>${html(i)}</li>`).join('\n')}\n</${tag}>`;
            }
            case 'details':
                return `<details${id(b)}${b.open ? ' open' : ''}>\n<summary>${html(b.summary)}</summary>\n${b.blocks.map((c) => render(c, define)).join('\n')}\n</details>`;
            case 'chart': {
                const head = `<tr><td></td>${b.series.map((s) => `<th scope="col" class="dfs-num">${html(s.name)}</th>`).join('')}</tr>`;
                const rows = b.labels.map((l, i) => `<tr><th scope="row">${html(l)}</th>${b.series.map((s) => `<td class="dfs-num">${s.values[i]?.toLocaleString('en-US') ?? ''}</td>`).join('')}</tr>`);
                return `<figure class="dfs-chart"${id(b)}>${b.title ? `<figcaption>${html(b.title)}</figcaption>` : ''}<div class="dfs-table" tabindex="0"><table>\n<thead>${head}</thead>\n<tbody>\n${rows.join('\n')}\n</tbody>\n</table></div></figure>`;
            }
            case 'footer':
                return `<footer class="dfs-footer"${id(b)}><p>${html(b.text)}</p></footer>`;
        }
    })();
    const terms = define(b);
    if (!terms.length)
        return out;
    return `${out}\n<dl class="dfs-terms">${terms.map(([t, d]) => `<div><dt>${html(t)}</dt><dd>${html(d)}</dd></div>`).join('')}</dl>`;
}
/**
 * HTML for the blocks. `plain` gives an `<article>` with `dfs-` classes and no styles.
 * `page` gives a standalone document with a small stylesheet, light and dark.
 */
export function toHtml(blocks, options = {}) {
    const define = glossary();
    const article = `<article class="dfs-report">\n${blocks.map((b) => render(b, define)).join('\n')}\n</article>\n`;
    if (options.variant !== 'page')
        return article;
    const heading = blocks.find((b) => b.type === 'heading');
    const title = options.title ?? (heading ? plainText(heading.text) : 'Report');
    return `<!doctype html>
<html lang="${escapeHtml(options.lang ?? 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
${article}</body>
</html>
`;
}
/** The `page` variant's stylesheet. */
const PAGE_CSS = `
:root {
  --bg: oklch(97.6% 0.0035 265); --fg: oklch(23.5% 0.073 271); --soft: oklch(43.8% 0.034 274);
  --muted: oklch(52.5% 0.035 273); --rule: oklch(90% 0.012 280); --wash: oklch(94.6% 0.007 265);
  --link: oklch(42.5% 0.228 266); --bar: oklch(80% 0.02 270); --shade: oklch(23.5% 0.073 271 / 0.14);
  --good: oklch(46.7% 0.106 156); --good-bg: oklch(95.4% 0.024 159);
  --warn: oklch(50% 0.12 60); --warn-bg: oklch(96% 0.035 80);
  --bad: oklch(50.9% 0.164 20); --bad-bg: oklch(95% 0.025 25);
  --info: oklch(42.5% 0.228 266); --info-bg: oklch(94.5% 0.025 268);
  --sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: oklch(16.2% 0.021 275); --fg: oklch(93% 0.015 278); --soft: oklch(76% 0.035 276);
    --muted: oklch(68% 0.045 277); --rule: oklch(28.2% 0.048 276); --wash: oklch(21% 0.026 274);
    --link: oklch(74% 0.14 271); --bar: oklch(42% 0.05 275); --shade: oklch(0% 0 0 / 0.6);
    --good: oklch(78.2% 0.16 157.5); --good-bg: oklch(23% 0.045 158);
    --warn: oklch(80% 0.13 70); --warn-bg: oklch(24% 0.04 70);
    --bad: oklch(74.2% 0.158 17); --bad-bg: oklch(23% 0.045 25);
    --info: oklch(74% 0.14 271); --info-bg: oklch(23% 0.05 270);
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 400 1rem/1.625 var(--sans); -webkit-text-size-adjust: 100%; }
.dfs-report { max-width: 52rem; margin: 0 auto; padding: 3rem 1rem 4rem; }
.dfs-report > * { margin: 0; }
.dfs-report > * + * { margin-top: 1.25rem; }
p, li, .dfs-terms { max-width: 65ch; text-wrap: pretty; }
h1, h2, h3 { line-height: 1.2; text-wrap: balance; letter-spacing: -0.015em; }
h1 { font-size: 2rem; font-weight: 700; margin: 0; }
h2 { font-size: 1.375rem; font-weight: 650; }
h3 { font-size: 1.125rem; font-weight: 650; }
.dfs-report > h2 { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--rule); }
.dfs-report > details + h2 { border-top: 0; padding-top: 0; margin-top: 2.5rem; }
.dfs-report > h2 + *, .dfs-report > h3 + * { margin-top: 0.5rem; }
.dfs-report > h3 { margin-top: 2rem; }
hgroup { display: flex; flex-direction: column; gap: 0.5rem; }
.dfs-kicker { margin: 0; color: var(--muted); font-size: 0.875rem; font-weight: 500; }
.dfs-lg { font-size: 1.25rem; line-height: 1.5; color: var(--soft); }
.dfs-sm, .dfs-terms { font-size: 0.875rem; }
a { color: var(--link); text-underline-offset: 0.2em; text-decoration-thickness: 1px; }
a:focus-visible, .dfs-table:focus-visible, summary:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
code { font-family: var(--mono); font-size: 0.875em; background: var(--wash); padding: 0.1em 0.3em; border-radius: 0.25rem; }
ul, ol { padding-left: 1.25rem; }
li + li { margin-top: 0.25rem; }
.dfs-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: 1.5rem 2rem; }
.dfs-report > .dfs-stats { margin-top: 2rem; }
.dfs-stat { display: flex; flex-direction: column; border-top: 1px solid var(--rule); padding-top: 0.75rem; }
.dfs-stat dt { order: 1; color: var(--soft); font-size: 0.875rem; font-weight: 500; line-height: 1.4; margin-top: 0.25rem; }
.dfs-stat dd { margin: 0; }
.dfs-value { font-size: 2rem; font-weight: 600; line-height: 1.1; letter-spacing: -0.025em; font-variant-numeric: tabular-nums; }
.dfs-value a { color: inherit; text-decoration: none; }
.dfs-value a:hover { text-decoration: underline; }
.dfs-note { order: 2; color: var(--muted); font-size: 0.8125rem; line-height: 1.4; }
.dfs-stat.dfs-good .dfs-value { color: var(--good); }
.dfs-stat.dfs-warn .dfs-value { color: var(--warn); }
.dfs-stat.dfs-bad .dfs-value { color: var(--bad); }
.dfs-table { overflow-x: auto; background: linear-gradient(to right, var(--bg) 40%, transparent) left / 2rem 100% no-repeat local, linear-gradient(to left, var(--bg) 40%, transparent) right / 2rem 100% no-repeat local, radial-gradient(farthest-side at 0 50%, var(--shade), transparent) left / 0.75rem 100% no-repeat scroll, radial-gradient(farthest-side at 100% 50%, var(--shade), transparent) right / 0.75rem 100% no-repeat scroll; }
table { width: 100%; border-collapse: collapse; font-size: 0.875rem; line-height: 1.45; }
th, td { padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; border-bottom: 1px solid var(--rule); }
th:first-child, td:first-child { padding-left: 0; }
th:last-child, td:last-child { padding-right: 0; }
thead th { color: var(--muted); font-weight: 500; font-size: 0.8125rem; border-bottom-color: var(--soft); white-space: nowrap; }
tbody th { font-weight: 400; }
td code { background: none; padding: 0; overflow-wrap: anywhere; }
.dfs-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dfs-badge { font-variant-numeric: tabular-nums; }
.dfs-badge.dfs-good, .dfs-badge.dfs-warn, .dfs-badge.dfs-bad, .dfs-badge.dfs-info { font-weight: 600; }
.dfs-badge.dfs-good { color: var(--good); } .dfs-badge.dfs-warn { color: var(--warn); }
.dfs-badge.dfs-bad { color: var(--bad); } .dfs-badge.dfs-info { color: var(--info); }
.dfs-bar { display: inline-block; vertical-align: middle; height: 0.5rem; width: 6rem; margin-right: 0.75rem; background: linear-gradient(var(--bar) 0 0) no-repeat left / calc(var(--w) * 1%) 100%; }
.dfs-callout { padding: 0.75rem 1rem; border-left: 2px solid var(--info); background: var(--info-bg); }
.dfs-callout p { margin: 0; }
.dfs-callout.dfs-good { border-color: var(--good); background: var(--good-bg); }
.dfs-callout.dfs-warn { border-color: var(--warn); background: var(--warn-bg); }
.dfs-callout.dfs-bad { border-color: var(--bad); background: var(--bad-bg); }
details { border-block: 1px solid var(--rule); }
summary { cursor: pointer; padding: 0.625rem 0; font-weight: 500; color: var(--soft); }
summary:hover { color: var(--fg); }
details > :not(summary) { margin: 0 0 1rem; font-size: 0.9375rem; }
.dfs-terms { margin: 0.75rem 0 0; color: var(--muted); }
.dfs-terms div + div { margin-top: 0.25rem; }
.dfs-terms dt { display: inline; font-style: italic; color: var(--soft); }
.dfs-terms dt::after { content: ": "; }
.dfs-terms dd { display: inline; margin: 0; }
.dfs-chart figcaption { font-weight: 600; margin-bottom: 0.5rem; }
.dfs-report > .dfs-footer { margin-top: 3rem; }
.dfs-footer { padding-top: 1rem; border-top: 1px solid var(--rule); color: var(--muted); font-size: 0.8125rem; }
.dfs-footer p { margin: 0; }
@media (max-width: 40rem) {
  .dfs-report { padding-top: 2rem; }
  h1 { font-size: 1.625rem; }
  .dfs-lg { font-size: 1.125rem; }
  .dfs-value { font-size: 1.625rem; }
  .dfs-stats { grid-template-columns: 1fr 1fr; gap: 1.25rem 1rem; }
  th, td { white-space: nowrap; }
  td code { overflow-wrap: normal; }
}
@media print {
  :root { --bg: #fff; --fg: #000; --soft: #333; --muted: #555; --rule: #bbb; --wash: transparent; --link: #000; --bar: #999;
    --good: #000; --warn: #000; --bad: #000; --info: #000; --good-bg: transparent; --warn-bg: transparent; --bad-bg: transparent; --info-bg: transparent; }
  .dfs-report { max-width: none; padding: 0; }
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 0.8em; }
  .dfs-table { overflow: visible; }
  details::details-content { content-visibility: visible; display: block; }
  summary { list-style: none; color: var(--fg); }
  h2, h3, summary { break-after: avoid; }
  tr, .dfs-stat, .dfs-callout { break-inside: avoid; }
}
`;
