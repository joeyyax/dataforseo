/** Color intent for a stat tile. */
export type Tone = 'neutral' | 'good' | 'warn' | 'bad';
/** Color intent for a table badge. */
export type BadgeTone = Tone | 'info';

/** Term → definition, opened in a popover from its first use. */
export type Terms = Record<string, string>;

/** One stat tile. */
export interface StatItem {
  label: string;
  value: string | number;
  note?: string;
  tone?: Tone;
  /** `#id` of the section the tile summarizes. */
  href?: string;
}

/** One table column and how to format its cells. */
export interface TableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  format?: 'text' | 'code' | 'number' | 'badge' | 'path' | 'bar';
  /** Badge value → tone. */
  tones?: Record<string, BadgeTone>;
  /** Definition opened from the header. */
  help?: string;
}

type BlockBody =
  | { type: 'heading'; text: string; level?: 1 | 2 | 3; kicker?: string }
  | { type: 'text'; text: string; size?: 'lg' | 'base' | 'sm'; terms?: Terms }
  | { type: 'stats'; items: StatItem[] }
  | { type: 'table'; columns: TableColumn[]; rows: Record<string, string | number | null>[]; sortable?: boolean; visible?: number }
  | { type: 'callout'; tone: 'info' | 'good' | 'warn' | 'bad'; title?: string; text: string; terms?: Terms }
  | { type: 'list'; items: string[]; ordered?: boolean; terms?: Terms }
  | { type: 'details'; summary: string; blocks: Block[]; open?: boolean }
  | { type: 'chart'; kind: 'bar' | 'line' | 'pie'; labels: string[]; series: { name: string; values: number[] }[]; title?: string }
  | { type: 'footer'; text: string };

/**
 * Report content as data for any renderer. Text fields take inline **bold**, `code` and [links].
 * `id` is stable across runs, so it works as an anchor or an update key.
 */
export type Block = BlockBody & { id?: string };

/** One line of "How this was measured": a short label and what it covered. */
export interface MethodLine {
  label: string;
  text: string;
}

/** A report before layout. `buildReport` turns it into blocks. */
export interface ReportSpec {
  /** Report type, shown over the title, e.g. "SEO snapshot". */
  kind: string;
  /** YYYY-MM-DD. */
  date: string;
  title: string;
  /** The one-line answer at the top. */
  answer: string;
  /** Jargon in the answer, explained in place. */
  answerTerms?: Terms;
  stats: StatItem[];
  /** What was checked, where, when, from what and with which filters. */
  method: MethodLine[];
  /** Action blocks, shown first. Empty means nothing to do. */
  actions: Block[];
  actionsTitle?: string;
  /** Why these actions and not others, one line under the heading. */
  actionsIntro?: string;
  /** Shown when `actions` is empty. Says what was checked, never a bare all-clear. */
  allClear?: string;
  sections?: Block[];
  source: string;
  /** What the run cost in USD. `buildReport` leaves it off the page. */
  cost: number;
  cached?: boolean;
  note?: string;
}

/** Turns a spec into blocks: title, answer, stat tiles, method, actions, sections and footer. */
export function buildReport(spec: ReportSpec): Block[] {
  const blocks: Block[] = [
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
    ...(spec.actionsIntro && spec.actions.length ? [{ id: 'actions-intro', type: 'text', text: spec.actionsIntro } as Block] : []),
    ...(spec.actions.length ? spec.actions : [{ id: 'all-clear', type: 'callout', tone: 'good', text: spec.allClear ?? 'Nothing needs attention.' } as Block]),
    ...(spec.sections ?? []),
  ];
  blocks.push({ id: 'footer', type: 'footer', text: `Data: ${spec.source}, ${longDate(spec.date)}.${spec.note ? ` ${spec.note}` : ''}` });
  // A tile lands on its section's heading when there is one, not the table under it.
  const ids = new Set(blocks.map((b) => b.id));
  const stats = blocks[2] as Extract<Block, { type: 'stats' }>;
  stats.items = stats.items.map((s) => (s.href && ids.has(`${s.href.slice(1)}-title`) ? { ...s, href: `${s.href}-title` } : s));
  return blocks;
}

/** Badge tones for every distinct value in one column. */
export function tonesFor(rows: Record<string, string | number | null>[], key: string, tone: (value: string) => BadgeTone): Record<string, BadgeTone> {
  const tones: Record<string, BadgeTone> = {};
  for (const r of rows) {
    const v = r[key];
    if (v !== null && v !== undefined && v !== '') tones[String(v)] = tone(String(v));
  }
  return tones;
}

/** Wraps a URL path in inline code. */
export function code(s: string): string {
  return `\`${s.replace(/`/g, '')}\``;
}

/** `$0`, `$0.0020`, `$0.028`. */
export function usd(n: number): string {
  if (n === 0) return '$0';
  return `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`;
}

/** Whole number with US thousands separators. */
export function count(n: number | null | undefined): string {
  return Math.round(Number(n ?? 0)).toLocaleString('en-US');
}

/** "1 search term", "3 search terms". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}

/** "the one search", "all 3 searches". */
export function every(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? `the one ${one}` : `all ${plural(n, one, many)}`;
}

/** "once", "3 times". */
export function times(n: number): string {
  return n === 1 ? 'once' : plural(n, 'time');
}

/** "The question", "The 25 questions". */
export function theTop(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? `The ${one}` : `The ${plural(n, one, many)}`;
}

/** Uppercases the first letter. */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The `YYYY-MM-DD` part of an ISO timestamp. */
export function day(iso: string): string {
  return iso.slice(0, 10);
}

/** `2026-11-08` → "November 8, 2026". */
export function longDate(iso: string): string {
  return new Date(`${day(iso)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** 0.123 → "12%"; anything above zero but under 1% reads "under 1%". */
export function percent(share: number): string {
  if (share > 0 && share < 0.005) return 'under 1%';
  return `${Math.round(share * 100)}%`;
}

/** "a", "a and b", "a, b and c": no Oxford comma. */
export function series(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
