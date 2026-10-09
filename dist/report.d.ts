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
    /** `path` takes a path or a `[path](url)` link. */
    format?: 'text' | 'code' | 'number' | 'badge' | 'path' | 'bar';
    /** Badge value → tone. */
    tones?: Record<string, BadgeTone>;
    /** Definition opened from the header. */
    help?: string;
}
/** A title. `kicker` is a short line shown over it, such as the report type and date. */
export interface HeadingBlock {
    type: 'heading';
    text: string;
    /** 2 when unset. */
    level?: 1 | 2 | 3;
    kicker?: string;
}
/** A paragraph. `size: 'lg'` marks the one-line answer at the top. */
export interface TextBlock {
    type: 'text';
    text: string;
    size?: 'lg' | 'base' | 'sm';
    terms?: Terms;
}
/** A row of stat tiles. */
export interface StatsBlock {
    type: 'stats';
    items: StatItem[];
}
/** Rows keyed by column `key`. `visible` is how many rows to show before a "show more". */
export interface TableBlock {
    type: 'table';
    columns: TableColumn[];
    rows: Record<string, string | number | null>[];
    sortable?: boolean;
    visible?: number;
}
/** A note set apart from the text. `title` is optional; `tone` says why it's there. */
export interface CalloutBlock {
    type: 'callout';
    tone: 'info' | 'good' | 'warn' | 'bad';
    title?: string;
    text: string;
    terms?: Terms;
}
/** A bulleted list, or numbered when `ordered`. */
export interface ListBlock {
    type: 'list';
    items: string[];
    ordered?: boolean;
    terms?: Terms;
}
/** Blocks behind a summary line, closed unless `open`. */
export interface DetailsBlock {
    type: 'details';
    summary: string;
    blocks: Block[];
    open?: boolean;
}
/** One value per label for each series. */
export interface ChartBlock {
    type: 'chart';
    kind: 'bar' | 'line' | 'pie';
    labels: string[];
    series: {
        name: string;
        values: number[];
    }[];
    title?: string;
}
/** The closing line: where the data came from and when. */
export interface FooterBlock {
    type: 'footer';
    text: string;
}
/**
 * Report content as data for any renderer. Text fields take inline **bold**, `code` and [links].
 * `id` is stable across runs, so it works as an anchor or an update key.
 */
export type Block = (HeadingBlock | TextBlock | StatsBlock | TableBlock | CalloutBlock | ListBlock | DetailsBlock | ChartBlock | FooterBlock) & {
    id?: string;
};
/** Turns blocks into output: a string, a request, anything. `spec` carries the date, kind and cost when a renderer needs them. */
export type Renderer<T> = (blocks: Block[], spec?: ReportSpec) => T;
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
export declare function buildReport(spec: ReportSpec): Block[];
/** Badge tones for every distinct value in one column. */
export declare function tonesFor(rows: Record<string, string | number | null>[], key: string, tone: (value: string) => BadgeTone): Record<string, BadgeTone>;
/** Wraps a URL path in inline code. */
export declare function code(s: string): string;
/** `$0`, `$0.0020`, `$0.028`. */
export declare function usd(n: number): string;
/** Whole number with US thousands separators. */
export declare function count(n: number | null | undefined): string;
/** "1 search term", "3 search terms". */
export declare function plural(n: number, one: string, many?: string): string;
/** "the one search", "all 3 searches". */
export declare function every(n: number, one: string, many?: string): string;
/** "once", "3 times". */
export declare function times(n: number): string;
/** "The question", "The 25 questions". */
export declare function theTop(n: number, one: string, many?: string): string;
/** Uppercases the first letter. */
export declare function capitalize(s: string): string;
/** The `YYYY-MM-DD` part of an ISO timestamp. */
export declare function day(iso: string): string;
/** `2026-11-08` → "November 8, 2026". */
export declare function longDate(iso: string): string;
/** 0.123 → "12%"; anything above zero but under 1% reads "under 1%". */
export declare function percent(share: number): string;
/** "a", "a and b", "a, b and c": no Oxford comma. */
export declare function series(items: string[]): string;
