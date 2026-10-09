# @joeyyax/dataforseo

DataForSEO client with a pluggable cache, the SEO checks built on it and builders for client-ready reports.

## Install

Installed from a tag, with the built `dist/` committed:

```sh
pnpm add github:joeyyax/dataforseo#v0.2.0
```

## Use

```ts
import { createDataForSeoClient, dailyBudget, seoSnapshot, DailyLimitError } from '@joeyyax/dataforseo';

const client = createDataForSeoClient({
  login: process.env.DATAFORSEO_LOGIN!,
  password: process.env.DATAFORSEO_PASSWORD!,
  cacheDir: '/data/dataforseo', // or `cache`: any CacheStore
});

const budget = await dailyBudget(client); // free: today's spend and the account's daily limit
const snapshot = await seoSnapshot(client, { domain: 'example.com' });
```

Paid responses are cached for 7 days under `cacheKey(endpoint, body)`, a SHA-256 hex digest. A cache that throws counts as a miss.

A 40203 response throws `DailyLimitError`: the account's daily spend limit is used up until midnight UTC.

## CacheStore

```ts
interface CacheStore {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
}
```

`createDiskCacheStore(dir)` writes one JSON file per key with its `expires_at`.

`createHttpCacheStore({ url, token })` reads `GET {url}/{key}` (`{ value }` or 404) and writes `PUT {url}/{key}` with `{ value, ttl_ms }`, sending `Authorization: Bearer <token>`. Timeouts (3s get, 10s set), network errors and non-2xx responses throw, so the client logs them and calls live.

## Release

Bump `version`, run `pnpm test && pnpm build`, commit `dist/`, tag `v<version>` and push the tag.
