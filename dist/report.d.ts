export type Tone = 'neutral' | 'good' | 'warn' | 'bad';
export type BadgeTone = Tone | 'info';
/** Term → definition, opened in a popover from its first use. */
export type Terms = Record<string, string>;
export interface StatItem {
    label: string;
    value: string | number;
    note?: string;
    tone?: Tone;
    /** `#id` of the section the tile summarizes. */
    href?: string;
}
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
type BlockBody = {
    type: 'heading';
    text: string;
    level?: 1 | 2 | 3;
    kicker?: string;
} | {
    type: 'text';
    text: string;
    size?: 'lg' | 'base' | 'sm';
    terms?: Terms;
} | {
    type: 'stats';
    items: StatItem[];
} | {
    type: 'table';
    columns: TableColumn[];
    rows: Record<string, string | number | null>[];
    sortable?: boolean;
    visible?: number;
} | {
    type: 'callout';
    tone: 'info' | 'good' | 'warn' | 'bad';
    title?: string;
    text: string;
    terms?: Terms;
} | {
    type: 'list';
    items: string[];
    ordered?: boolean;
    terms?: Terms;
} | {
    type: 'details';
    summary: string;
    blocks: Block[];
    open?: boolean;
} | {
    type: 'chart';
    kind: 'bar' | 'line' | 'pie';
    labels: string[];
    series: {
        name: string;
        values: number[];
    }[];
    title?: string;
} | {
    type: 'footer';
    text: string;
};
/**
 * Report content as data, a subset of the artifact store's block schema. Text fields take inline
 * **bold**, `code` and [links]. `id` lets a merge republish replace one block and doubles as an anchor.
 */
export type Block = BlockBody & {
    id?: string;
};
/** One line of "How this was measured": a short label and what it covered. */
export interface MethodLine {
    label: string;
    text: string;
}
export interface ReportSpec {
    /** Report type for the kicker, e.g. "SEO snapshot". */
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
    /** What the run cost, for the tool result. Client pages don't show it. */
    cost: number;
    cached?: boolean;
    note?: string;
}
/** Kicker, title, answer, stat tiles, method, actions, sections and footer, in that order. */
export declare function buildReport(spec: ReportSpec): Block[];
/** Badge tones for every distinct value in one column. */
export declare function tonesFor(rows: Record<string, string | number | null>[], key: string, tone: (value: string) => BadgeTone): Record<string, BadgeTone>;
/** Wraps a URL path in inline code. */
export declare function code(s: string): string;
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
export declare function capitalize(s: string): string;
export declare function day(iso: string): string;
/** `2026-11-08` → "November 8, 2026". */
export declare function longDate(iso: string): string;
/** 0.123 → "12%"; anything above zero but under 1% reads "under 1%". */
export declare function percent(share: number): string;
/** "a", "a and b", "a, b and c": no Oxford comma. */
export declare function series(items: string[]): string;
export {};
