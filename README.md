# @joeyyax/dataforseo

Check how a site shows up in search and get results someone outside SEO can read.

It calls [DataForSEO](https://dataforseo.com), a pay-per-use API for search data, and saves every answer so asking again costs nothing. Each check returns plain data. A matching report builder turns that data into a short report: the answer first, then what to do, then the detail.

## Install

Install from a release tag, which includes the built code. It needs Node 22 or later.

```sh
pnpm add github:joeyyax/dataforseo#v0.3.0
```

## First use

```ts
import { buildReport, createDataForSeoClient, seoSnapshot, snapshotReport } from '@joeyyax/dataforseo';

const client = createDataForSeoClient({
  login: process.env.DATAFORSEO_LOGIN!,
  password: process.env.DATAFORSEO_PASSWORD!,
  cacheDir: './.dataforseo-cache',
});

const snapshot = await seoSnapshot(client, { domain: 'example.com' });
console.log(snapshot.est_monthly_visits, snapshot.cost, snapshot.cached);

const blocks = buildReport(snapshotReport(snapshot, '2026-10-09'));
```

Run it twice and the second run returns `cost: 0` and `cached: true`.

## Credentials

DataForSEO gives each account an API login and an API password, separate from the dashboard password. Pass them as `login` and `password`. Without both, every call throws before it sends anything.

## Caching

The client saves each paid response for 7 days, keyed by a hash of the endpoint and the request. A repeat call within that time is free. To pay for fresh data, pass `refresh: true` to any check.

A cache store is where the client keeps those responses. Pick one of three, or none to call DataForSEO every time. When a store fails, the client treats it as a miss, calls DataForSEO and passes the error to `onCacheError` (`console.error` by default).

### Disk

One JSON file per response, in a folder you name:

```ts
const client = createDataForSeoClient({ login, password, cacheDir: '/var/cache/dataforseo' });
```

### HTTP

Shares one cache between apps on different machines:

```ts
const client = createDataForSeoClient({
  login,
  password,
  cache: createHttpCacheStore({ url: 'https://cache.example.com/dataforseo', token: process.env.CACHE_TOKEN! }),
});
```

The server needs two routes, both checking `Authorization: Bearer <token>`:

- `GET {url}/{key}` returns `{ "value": ... }`, or 404 when there's no entry.
- `PUT {url}/{key}` takes `{ "value": ..., "ttl_ms": 604800000 }` and keeps it for `ttl_ms`.

Gets time out after 3 seconds and sets after 10. Change that with `getTimeoutMs` and `setTimeoutMs`.

### Your own

Any object with `get` and `set` works. Keys are 64-character hex strings.

```ts
import type { CacheStore } from '@joeyyax/dataforseo';

const entries = new Map<string, { value: unknown; expires: number }>();
const memory: CacheStore = {
  async get(key) {
    const hit = entries.get(key);
    return hit && hit.expires > Date.now() ? hit.value : null;
  },
  async set(key, value, ttlMs) {
    entries.set(key, { value, expires: Date.now() + ttlMs });
  },
};
```

## Daily budget

Set a daily spend limit in the DataForSEO dashboard. `dailyBudget` reads today's spend against it, for free:

```ts
const { spent, limit, left } = await dailyBudget(client);
```

`limit` and `left` are `null` when no limit is set. `balance(client)` returns the account balance, total deposits and spend, also free.

Once the limit is used up, paid calls throw `DailyLimitError` until midnight UTC. Its message reads "DataForSEO's daily spend limit ($3) is used up. It resets at midnight UTC." Other API errors throw `DataForSeoError`, with DataForSEO's `status` code and the `endpoint`.

```ts
try {
  await seoSnapshot(client, { domain: 'example.com' });
} catch (err) {
  if (!(err instanceof DailyLimitError)) throw err;
  console.log(`Try again after ${nextUtcMidnight().toISOString()}`);
}
```

## Checks

Each check returns plain data, including `cost` in USD, `cached` and `fetched_at`. Costs are approximate and follow DataForSEO's pricing, which can change.

Several checks take the same relevance options to sort search terms:

- `brand` and `aliases`: names that mean the business.
- `topics`: what the business does, as `"Label: word, word"`. Without topics, terms aren't sorted.
- `area`: places it serves. A term naming a US state, a large US city or Canada outside that area counts as another area.

### SEO snapshot

How many search terms a domain shows up for in Google's top 100 and its estimated visits a month. It lists the 100 terms that bring the most visits and the pages they lead to. One call, about $0.02.

```ts
const snapshot = await seoSnapshot(client, {
  domain: 'example.com',
  brand: 'Example Plumbing',
  topics: ['Plumbing: plumber, drain, pipe', 'Water heaters: water heater'],
  area: ['Springfield', 'Illinois'],
});
```

Rankings come from DataForSEO Labs, its estimate of Google results, refreshed about monthly.

### Competitor candidates

Domains that rank for the same search terms, with directories, social sites and public bodies left out. About $0.02 to $0.04. It costs less after a snapshot of the same domain, since it reuses that call.

```ts
const { candidates } = await competitorCandidates(client, { domain: 'example.com', brand: 'Example Plumbing' });
```

### Competitor gap

Search terms where a competitor is on Google's page one and the domain is lower or missing. Two calls per competitor, about $0.02 to $0.04 for each competitor.

```ts
const gap = await competitorGap(client, {
  domain: 'example.com',
  competitors: ['rival.example', 'other.example'],
  topics: ['Plumbing: plumber, drain, pipe'],
});
```

### Local visibility

Where a business shows in Google Maps for each search, and who holds the top 3. One call per search, about $0.002 each. It throws before paying when there are more searches than `max_keywords` (5 by default).

```ts
const local = await localVisibility(client, {
  business: 'Example Plumbing',
  domain: 'example.com',
  keywords: ['plumber', 'drain cleaning'],
  location: 'Springfield,Illinois,United States',
});
```

`location` also takes coordinates: `'39.78,-89.65'`.

### AI visibility

How often ChatGPT and Google AI Overviews link the site as a source and name the business. One call, about $0.10. `prompts: 25` adds the top questions whose answers cite the site, in a second call of about $0.10. Each call can take up to 2 minutes.

```ts
const ai = await aiVisibility(client, { domain: 'example.com', brand: 'Example Plumbing', keywords: ['water heater'] });
```

### Ranking baseline

Saves the domain's top 100 terms and their positions. Each later run compares with the most recent snapshot before it for the same location and language. One call, about $0.02. It's free when a snapshot made the same call within 7 days.

```ts
const snapshots = createDiskSnapshotStore('./snapshots');
const first = await rankBaseline(client, snapshots, { domain: 'example.com', label: 'Before relaunch' });
const later = await rankBaseline(client, snapshots, { domain: 'example.com' });
console.log(later.diff?.declined);
```

DataForSEO refreshes rankings about monthly, so a check sooner than that usually finds nothing to compare. To store snapshots somewhere else, implement `SnapshotStore`.

### Backlink redirects

For a site move: takes the domain's most-linked pages and requests each path on the site it's moving to. It reports which paths break, redirect or still work. One call, about $0.03 for the default 100 pages. The path checks go straight to your site and cost nothing.

```ts
const links = await backlinkRedirects(client, {
  domain: 'example.com',
  new_origin: 'https://staging.example.com',
  headers: { Cookie: 'preview=1' },
});
```

`headers` go to the path checks only, never to DataForSEO. Pointing `new_origin` at the live site finds links that fail there today.

## Reports

Each check except competitor candidates has a report builder: `snapshotReport`, `gapReport`, `localReport`, `aiReport`, `baselineReport` and `redirectReport`. Each takes the check's result and a `YYYY-MM-DD` date and returns a `ReportSpec`.

`buildReport(spec)` turns that into blocks: a title, a one-line answer, stat tiles, how it was measured, what to do and the detail. The block types are heading, text, stats, table, callout, list, details, chart and footer. Text can hold `**bold**`, `` `code` `` and `[links](https://example.com)`. Rendering is up to you:

```ts
const spec = gapReport(gap, '2026-10-09');
for (const block of buildReport(spec)) {
  if (block.type === 'heading') console.log(`${'#'.repeat(block.level ?? 2)} ${block.text}`);
  if (block.type === 'text') console.log(block.text);
}
```

The wording avoids SEO terms, and `GLOSSARY` defines the ones it keeps. `spec.cost` isn't on the page.

## Reference

Every export has a doc comment. The full list is in [`src/index.ts`](src/index.ts).

## Versioning

Releases are Git tags with semantic version numbers, and changes are in [`CHANGELOG.md`](CHANGELOG.md). An npm release comes later. To release, bump `version`, run `pnpm test && pnpm check:dist`, commit `dist/` and tag `v<version>`.

## License

MIT.
