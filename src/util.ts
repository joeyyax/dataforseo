/** `https://www.Example.com/x` → `example.com`, the target form DataForSEO expects. */
export function normalizeDomain(input: string): string {
  const host = input.trim().replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0];
  return host.replace(/^www\./i, '').toLowerCase();
}

/** `Promise.all` over `items` with at most `limit` calls in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Rounds USD to six decimals, DataForSEO's precision. */
export function money(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
