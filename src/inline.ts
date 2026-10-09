import type { Block, TableColumn, Terms } from './report.js';

/** A piece of block text: plain, **bold**, `code` or a [link](url). */
export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] };

const MARKUP = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Splits text into its inline markup. Anything else, HTML included, stays plain text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKUP)) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: 'code', text: m[1] });
    else if (m[2] !== undefined) out.push({ type: 'bold', children: parseInline(m[2]) });
    else if (safeHref(m[4])) out.push({ type: 'link', href: m[4], children: parseInline(m[3]) });
    else out.push(...parseInline(m[3]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/** True for http, https, mailto and relative links. */
export function safeHref(href: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) || /^(https?|mailto):/i.test(href);
}

/** The text without markup. */
export function plainText(text: string): string {
  const flat = (parts: Inline[]): string => parts.map((p) => ('children' in p ? flat(p.children) : p.text)).join('');
  return flat(parseInline(text));
}

const LINK_ONLY = /^\[([^\]]+)\]\(([^)\s]+)\)$/;

/** A table cell as inline markup: numbers with thousands separators, code and path cells as code, a path cell holding a `[path](url)` as a linked path. */
export function cellMarkup(column: TableColumn, value: string | number | null | undefined): Inline[] {
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'number' && (column.format === 'number' || column.format === 'bar')) return [{ type: 'text', text: value.toLocaleString('en-US') }];
  if (column.format === 'path') {
    const link = String(value).match(LINK_ONLY);
    if (link && safeHref(link[2] as string)) return [{ type: 'link', href: link[2] as string, children: [{ type: 'code', text: link[1] as string }] }];
  }
  if (column.format === 'code' || column.format === 'path') return [{ type: 'code', text: String(value) }];
  return parseInline(String(value));
}

/** True when a column holds numbers and reads best right-aligned. */
export function isNumeric(column: TableColumn): boolean {
  return column.align === 'right' || column.format === 'number' || column.format === 'bar';
}

/** Label for a callout without a title. */
export const CALLOUT_LABELS = { info: 'Note', good: 'Good news', warn: 'Warning', bad: 'Problem' } as const;

/** Adds a period unless the label already ends in punctuation. */
export function withStop(label: string): string {
  return /[.?!:]$/.test(label) ? label : `${label}.`;
}

/** Remembers which definitions a document has shown, so each term is explained once, at its first use. */
export function glossary() {
  const seen = new Set<string>();
  return (block: Block): [string, string][] => {
    const pairs: [string, string][] = [];
    const terms: Terms = 'terms' in block && block.terms ? block.terms : {};
    for (const [term, text] of Object.entries(terms)) pairs.push([term, text]);
    if (block.type === 'table') for (const c of block.columns) if (c.help) pairs.push([c.label, c.help]);
    return pairs.filter(([term, text]) => {
      const fresh = !seen.has(term.toLowerCase()) && !seen.has(text);
      seen.add(term.toLowerCase());
      seen.add(text);
      return fresh;
    });
  };
}
