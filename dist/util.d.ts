/** `https://www.Example.com/x` → `example.com`, the target form DataForSEO expects. */
export declare function normalizeDomain(input: string): string;
/** `Promise.all` over `items` with at most `limit` calls in flight; results keep input order. */
export declare function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]>;
/** Rounds USD to six decimals, DataForSEO's precision. */
export declare function money(n: number): number;
