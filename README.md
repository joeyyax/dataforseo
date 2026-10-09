# @joeyyax/dataforseo

Check how a site shows up in search and get results someone outside SEO can read.

It calls [DataForSEO](https://dataforseo.com), a pay-per-use API for search data, and saves every answer so asking again costs nothing. Each check returns plain data. A matching report builder turns that data into a short report: the answer first, then what to do, then the detail.

## Install

Install from a release tag, which includes the built code. It needs Node 22 or later.

```sh
pnpm add github:joeyyax/dataforseo#v0.6.0
```

## First use

```ts
import { buildReport, createDataForSeoClient, seoSnapshot, snapshotReport, toMarkdown } from '@joeyyax/dataforseo';

const client = createDataForSeoClient({
  login: process.env.DATAFORSEO_LOGIN!,
  password: process.env.DATAFORSEO_PASSWORD!,
  cacheDir: './.dataforseo-cache',
});

const snapshot = await seoSnapshot(client, { domain: 'example.com' });
console.log(snapshot.est_monthly_visits, snapshot.cost, snapshot.cached);

console.log(toMarkdown(buildReport(snapshotReport(snapshot, '2026-10-09'))));
```

It prints the estimate, what it cost and whether it came from the cache, then the report as Markdown. Run it twice and the second run returns `cost: 0` and `cached: true`.

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

Once the limit is used up, paid calls throw `DailyLimitError` until midnight UTC. Its message reads "DataForSEO's daily spend limit ($10) is used up. It resets at midnight UTC." Other API errors throw `DataForSeoError`, with DataForSEO's `status` code and the `endpoint`.

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

### Rank check

Where the domain shows on Google for search terms you choose: its position, the page and what else is on the results page. One search per term. It throws before paying when there are more terms than `max_keywords` (100 by default). It throws `DailyLimitError` when the searches could cost more than what's left of today's spend limit.

```ts
const ranks = await rankCheck(client, {
  domain: 'example.com',
  keywords: ['plumber springfield', 'drain cleaning'],
  location: 'Springfield,Illinois,United States',
});
```

Each term has a `position`, which is `null` outside the top `depth` results (10 by default, up to 100). A result on `www.example.com` or another subdomain counts. `device: 'mobile'` searches as a phone.

The mode trades price for speed. Prices are for the first 10 results of one search, and each further 10 costs 25% less.

| Mode | Per search | Results in |
| --- | --- | --- |
| `queue` (default) | $0.0006 | about 5 minutes |
| `priority` | $0.0012 | about 1 minute |
| `live` | $0.002 | a few seconds |

A queued check of 100 terms costs about $0.06. `queue` and `priority` send terms in batches of 100, then check for results every 10 seconds (`pollMs`) for up to 10 minutes (`timeoutMs`). After that, `QueueTimeoutError` lists the IDs of the paid searches. Each term is cached on its own, so a rerun pays only for terms not searched in the last 7 days, in any mode.

The SEO snapshot and ranking baseline estimate positions for terms the domain already ranks for, from data DataForSEO refreshes about monthly. A rank check runs the searches you name on Google the day you run it, including terms the domain doesn't rank for.

To see what moved, keep each result and pass the earlier one to `rankReport`, or to `rankDiff` for the data alone:

```ts
import { readFileSync, writeFileSync } from 'node:fs';

const previous = JSON.parse(readFileSync('ranks.json', 'utf8'));
const spec = rankReport(ranks, '2026-11-09', previous);
writeFileSync('ranks.json', JSON.stringify(ranks));
```

### Ranking baseline

Saves the domain's top 100 terms and their positions. Each run after the first compares with the most recent snapshot before it for the same location and language. One call, about $0.02. It's free when a snapshot made the same call within 7 days.

```ts
const snapshots = createDiskSnapshotStore('./snapshots');
const first = await rankBaseline(client, snapshots, { domain: 'example.com', label: 'Before relaunch' });
const later = await rankBaseline(client, snapshots, { domain: 'example.com' });
console.log(later.diff?.declined);
```

DataForSEO refreshes rankings about monthly, so checks less than a month apart usually find nothing to compare. To store snapshots somewhere else, implement `SnapshotStore`.

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

A report turns a check's result into a page someone outside SEO can read: the answer first, then what to do, then the detail. It takes three steps:

1. A report builder takes a check's result and a `YYYY-MM-DD` date and returns a `ReportSpec`. Each check except competitor candidates has one: `snapshotReport`, `gapReport`, `localReport`, `aiReport`, `rankReport`, `baselineReport` and `redirectReport`. `rankReport` also takes an earlier rank check and reports what moved.
2. `buildReport(spec)` lays the spec out as blocks: a title, a one-line answer, stat tiles, how it was measured, what to do and the detail.
3. A renderer turns the blocks into output: Markdown, HTML or your own format.

```ts
const spec = gapReport(gap, '2026-10-09');
const blocks = buildReport(spec);
```

The wording avoids SEO terms, and `GLOSSARY` defines the ones it keeps. The renderers show each definition once, under the term's first use. `spec.cost` isn't on the page.

### Markdown

`toMarkdown(blocks)` returns GitHub-flavored Markdown. The same blocks always give the same text.

```ts
import { writeFileSync } from 'node:fs';

writeFileSync('gap.md', toMarkdown(blocks));
```

Stat tiles become a list, callouts become quotes and charts become a table of their values.

### HTML

`toHtml(blocks)` returns an `<article>` with no styles. Every element you'd style has a `dfs-` class.

```ts
const fragment = toHtml(blocks);
```

`variant: 'page'` returns a whole document with one small stylesheet: system fonts, light and dark themes, print styles and tables that scroll inside their own box on phones.

```ts
writeFileSync('gap.html', toHtml(blocks, { variant: 'page' }));
```

Both escape all text. Only bold, code and links become HTML, and links get `rel="noopener"`. A link that isn't `http`, `https`, `mailto` or relative stays plain text.

### Your own renderer

A renderer is a function that takes the blocks, and the spec when it needs the date or title: `Renderer<T>`. Blocks are plain JSON, so a renderer can also send them to a service that does the rendering:

```ts
import type { Renderer } from '@joeyyax/dataforseo';

const publish: Renderer<Promise<string>> = async (blocks, spec) => {
  const res = await fetch('https://reports.example.com/api', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.REPORTS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: spec?.title, date: spec?.date, blocks }),
  });
  if (!res.ok) throw new Error(`Report service returned ${res.status}`);
  return (await res.json()).url;
};

const url = await publish(blocks, spec);
```

Text fields can hold `**bold**`, `` `code` `` and `[links](https://example.com)`, and `parseInline(text)` splits them into parts. Any block can have an `id`, which stays the same across runs, for an anchor or an update key. Each type is exported on its own (`HeadingBlock`, `TableBlock` and the rest), and `Block` is their union:

| Block | Fields |
| --- | --- |
| `heading` | `text`, `level` (1 to 3, 2 by default), `kicker` |
| `text` | `text`, `size` (`lg`, `base` or `sm`), `terms` |
| `stats` | `items`, each with `label`, `value`, `note`, `tone` and `href` |
| `table` | `columns`, each with `key`, `label`, `align`, `format`, `tones` and `help`; `rows`, `sortable`, `visible` |
| `callout` | `tone` (`info`, `good`, `warn` or `bad`), `title`, `text`, `terms` |
| `list` | `items`, `ordered`, `terms` |
| `details` | `summary`, `blocks`, `open` |
| `chart` | `kind` (`bar`, `line` or `pie`), `labels`, `series` (each a `name` and `values`), `title` |
| `footer` | `text` |

`terms` maps a term to its definition. A column's `format` is `text`, `code`, `number`, `badge`, `path` or `bar`. A `path` cell holds a path or a `[path](url)` link, which renders as the path linked to the page.

## Reference

Every export has a doc comment. The full list is in [`src/index.ts`](src/index.ts).

## Versioning

Releases are Git tags with semantic version numbers, and changes are in [`CHANGELOG.md`](CHANGELOG.md). To release, bump `version`, run `pnpm test && pnpm check:dist`, commit `dist/` and tag `v<version>`.

## License

MIT.
