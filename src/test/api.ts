import { createDataForSeoClient, type DataForSeoClient } from '../index.js';

export const API = 'https://api.dataforseo.com/v3';

/** A successful DataForSEO response wrapping one task result. */
export function apiResponse(result: unknown, cost = 0.01): Response {
  return new Response(JSON.stringify({
    status_code: 20000, status_message: 'Ok.', cost,
    tasks: [{ status_code: 20000, status_message: 'Ok.', cost, result: [result] }],
  }), { status: 200 });
}

export interface ApiCall { url: string; body: any }

/** A fake DataForSEO API routed by endpoint path; each route returns [result, cost]. */
export function fakeApi(routes: Record<string, (body: any) => [unknown, number]>) {
  const calls: ApiCall[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body))[0] : undefined;
    calls.push({ url, body });
    const route = routes[url.replace(API, '')];
    if (!route) throw new Error(`unexpected ${url}`);
    const [result, cost] = route(body);
    return apiResponse(result, cost);
  }) as typeof fetch;
  return { fetchFn, calls };
}

/** A client over a fake API with a disk cache in `cacheDir`. */
export function fakeClient(routes: Record<string, (body: any) => [unknown, number]>, cacheDir: string, now?: () => number) {
  const { fetchFn, calls } = fakeApi(routes);
  const client: DataForSeoClient = createDataForSeoClient({ login: 'l', password: 'p', cacheDir, fetchFn, now });
  return { client, calls, paths: () => calls.map((c) => c.url.replace(API, '')) };
}

/** One ranked_keywords item. */
export function ranked(keyword: string, position: number, volume: number, etv: number, url: string) {
  return {
    keyword_data: { keyword, keyword_info: { search_volume: volume } },
    ranked_serp_element: { serp_item: { type: 'organic', rank_group: position, relative_url: url, etv } },
  };
}

/** A ranked_keywords result: 312 terms, four of them listed. */
export const RANKED = {
  total_count: 312,
  metrics: { organic: { pos_1: 10, pos_2_3: 8, pos_4_10: 40, pos_11_20: 50, pos_21_30: 30, pos_91_100: 4, etv: 1240.6, count: 312 } },
  items: [
    ranked('plumber springfield', 2, 2400, 500, '/'),
    ranked('water heater repair', 6, 1900, 120, '/water-heaters'),
    ranked('drain cleaning', 14, 880, 20, '/drains'),
    ranked('emergency plumber', 8, 3600, 90, '/'),
  ],
};
