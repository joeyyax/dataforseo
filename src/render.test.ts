import { describe, expect, it } from 'vitest';
import { buildReport, parseInline, toHtml, toMarkdown, type Block } from './index.js';
import { sampleReports } from './test/report-fixtures.js';

const everyType: Block[] = [
  { id: 'title', type: 'heading', level: 1, text: 'Example report', kicker: 'Sample · October 8, 2026' },
  { id: 'answer', type: 'text', size: 'lg', text: 'The **answer**, with `code` and a [link](https://example.com).', terms: { answer: 'The one line at the top.' } },
  { id: 'stats', type: 'stats', items: [{ label: 'Visits', value: 1241, note: 'a month', tone: 'good', href: '#rows' }, { label: 'Share', value: '7%' }] },
  { id: 'rows-title', type: 'heading', text: 'Rows' },
  {
    id: 'rows',
    type: 'table',
    columns: [
      { key: 'term', label: 'Term' },
      { key: 'position', label: 'Position', format: 'badge', tones: { '#2': 'good', '#14': 'neutral' }, help: 'Where it ranks.' },
      { key: 'visits', label: 'Visits', format: 'number' },
      { key: 'share', label: 'Share', format: 'bar' },
      { key: 'url', label: 'Page', format: 'path' },
    ],
    rows: [
      { term: 'plumber', position: '#2', visits: 2400, share: 50, url: '/' },
      { term: 'drain', position: '#14', visits: null, share: 25, url: '/drains' },
    ],
  },
  { id: 'warn', type: 'callout', tone: 'warn', title: 'Check this', text: 'One page redirects home.' },
  { id: 'info', type: 'callout', tone: 'info', text: 'No title, so the tone names it.' },
  { id: 'steps', type: 'list', ordered: true, items: ['First', 'Second'] },
  { id: 'more', type: 'details', summary: 'How this was measured', open: true, blocks: [{ type: 'list', items: ['**What:** everything'] }] },
  { id: 'trend', type: 'chart', kind: 'bar', title: 'Visits by month', labels: ['Sep', 'Oct'], series: [{ name: 'Visits', values: [1100, 1241] }] },
  { id: 'footer', type: 'footer', text: 'Data: example, October 8, 2026.' },
];

describe('toMarkdown', () => {
  it('renders every block type', () => {
    expect(toMarkdown(everyType)).toMatchSnapshot();
  });

  for (const [name, spec] of Object.entries(sampleReports())) {
    it(`renders the ${name} report`, () => {
      expect(toMarkdown(buildReport(spec))).toMatchSnapshot();
    });
  }

  it('escapes markup outside the supported inline set', () => {
    const md = toMarkdown([
      { type: 'text', text: '<script>alert(1)</script> a | b *not bold* _x_ snake_case' },
      { type: 'text', text: '# not a heading' },
      { type: 'table', columns: [{ key: 'a', label: 'A|B' }], rows: [{ a: 'x | y\nz' }] },
    ]);
    expect(md).toContain('\\<script\\>alert(1)\\</script\\> a \\| b \\*not bold\\* \\_x\\_ snake_case');
    expect(md).toContain('\\# not a heading');
    expect(md).toContain('| A\\|B |');
    expect(md).toContain('| x \\| y z |');
  });

  it('drops unsafe links to their text', () => {
    expect(toMarkdown([{ type: 'text', text: '[click](JavaScript:void0) [ok](https://example.com/?q=<x>)' }])).toBe('click [ok](https://example.com/?q=%3Cx%3E)\n');
  });

  it('explains each term once, at its first use', () => {
    const md = toMarkdown([
      { type: 'text', text: 'Page one.', terms: { 'page one': 'Positions #1 to #10.' } },
      { type: 'text', text: 'Page one again.', terms: { 'page one': 'Positions #1 to #10.' } },
    ]);
    expect(md.match(/Positions #1 to #10/g)).toHaveLength(1);
  });
});

describe('toHtml', () => {
  it('renders every block type as a plain fragment', () => {
    expect(toHtml(everyType)).toMatchSnapshot();
  });

  for (const [name, spec] of Object.entries(sampleReports())) {
    it(`renders the ${name} report`, () => {
      expect(toHtml(buildReport(spec))).toMatchSnapshot();
    });
  }

  it('wraps the fragment in a standalone page', () => {
    const blocks = buildReport(sampleReports()['seo-snapshot']);
    const page = toHtml(blocks, { variant: 'page' });
    expect(page).toMatch(/^<!doctype html>\n<html lang="en">/);
    expect(page).toContain('<title>acmeplumbing.example on Google</title>');
    expect(page).toContain('prefers-color-scheme: dark');
    expect(page).toContain('@media print');
    expect(page).toContain(toHtml(blocks));
    expect(page).not.toMatch(/<script|<link/);
  });

  it('escapes all text and keeps only the supported markup', () => {
    const html = toHtml(
      [
        { id: '"><script>', type: 'heading', level: 1, text: '<img src=x onerror=alert(1)>' },
        { type: 'text', text: '**<b>bold</b>** `<i>` [x](https://example.com/?a="b"&c=<d>) [bad](javascript:void0) [data](data:text/html,hi)' },
        { type: 'stats', items: [{ label: '<em>', value: '<u>', href: 'javascript:alert(1)' }] },
        { type: 'table', columns: [{ key: 'a', label: '<th>', format: 'path' }], rows: [{ a: '</td><script>' }] },
        { type: 'callout', tone: 'bad', title: '<x>', text: '"quoted"' },
      ],
      { variant: 'page', title: '</title><script>' },
    );
    expect(html).not.toMatch(/<(script|img|b|i|em|u|x|th>)\b[^/]/);
    expect(html).toContain('<h1 id="&#34;&#62;&#60;script&#62;">&#60;img src=x onerror=alert(1)&#62;</h1>');
    expect(html).toContain('<strong>&#60;b&#62;bold&#60;/b&#62;</strong> <code>&#60;i&#62;</code>');
    expect(html).toContain('<a href="https://example.com/?a=&#34;b&#34;&#38;c=&#60;d&#62;" rel="noopener">x</a>');
    expect(html).toContain(' bad data');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<title>&#60;/title&#62;&#60;script&#62;</title>');
  });

  it('gives every link rel="noopener"', () => {
    const html = toHtml(buildReport(sampleReports()['ai-visibility']).concat({ type: 'text', text: '[a](https://example.com) [b](/c)' }));
    const links = html.match(/<a href="[^#][^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) expect(a).toContain('rel="noopener"');
  });
});

describe('parseInline', () => {
  it('reads bold, code and links, and leaves unmatched markers as text', () => {
    expect(parseInline('**a `b`** [c](/d) **open')).toEqual([
      { type: 'bold', children: [{ type: 'text', text: 'a ' }, { type: 'code', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'link', href: '/d', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' **open' },
    ]);
  });
});
