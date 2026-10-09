import type { Block } from './report.js';
/** `plain` is a fragment with no styles. `page` is a whole document with its own stylesheet. */
export interface HtmlOptions {
    variant?: 'plain' | 'page';
    /** The page `<title>`. Defaults to the first heading. */
    title?: string;
    /** The page `lang`. Defaults to `en`. */
    lang?: string;
}
/**
 * HTML for the blocks. `plain` gives an `<article>` with `dfs-` classes and no styles.
 * `page` gives a standalone document with a small stylesheet, light and dark.
 */
export declare function toHtml(blocks: Block[], options?: HtmlOptions): string;
