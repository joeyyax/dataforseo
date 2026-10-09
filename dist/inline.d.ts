import type { Block, TableColumn } from './report.js';
/** A piece of block text: plain, **bold**, `code` or a [link](url). */
export type Inline = {
    type: 'text';
    text: string;
} | {
    type: 'code';
    text: string;
} | {
    type: 'bold';
    children: Inline[];
} | {
    type: 'link';
    href: string;
    children: Inline[];
};
/** Splits text into its inline markup. Anything else, HTML included, stays plain text. */
export declare function parseInline(text: string): Inline[];
/** True for http, https, mailto and relative links. */
export declare function safeHref(href: string): boolean;
/** The text without markup. */
export declare function plainText(text: string): string;
/** A table cell as inline markup: numbers with thousands separators, code and path cells as code. */
export declare function cellMarkup(column: TableColumn, value: string | number | null | undefined): Inline[];
/** True when a column holds numbers and reads best right-aligned. */
export declare function isNumeric(column: TableColumn): boolean;
/** Label for a callout without a title. */
export declare const CALLOUT_LABELS: {
    readonly info: "Note";
    readonly good: "Good news";
    readonly warn: "Warning";
    readonly bad: "Problem";
};
/** Adds a period unless the label already ends in punctuation. */
export declare function withStop(label: string): string;
/** Remembers which definitions a document has shown, so each term is explained once, at its first use. */
export declare function glossary(): (block: Block) => [string, string][];
