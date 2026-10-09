/** `https://www.Example.com/x` → `example.com`, the target form DataForSEO expects. */
export declare function normalizeDomain(input: string): string;
export declare function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]>;
export declare function money(n: number): number;
