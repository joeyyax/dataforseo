# Changelog

## 0.6.0 (2026-10-09)

### Added

- `MapsListing` has `url`, the listing's website, and `maps_url`, its Google Maps page. Both are optional, so earlier results still fit the type.
- `snapshotOpportunities` returns `also` with each row: the other terms on the same page.
- A `path` table cell can hold a `[path](url)` link. `toHtml` and `toMarkdown` render it as the path linked to the page.

### Changed

Every report shows what its check returned, and links each page.

- Pages are links in every report: ranking pages, cited pages, competitor pages, old addresses and where they land.
- `snapshotReport` names the similar terms behind each opportunity and adds what the searcher wants to the term tables.
- `gapReport` links each competitor's ranking page, adds what the searcher wants, lists every left-out example and adds each competitor's terms where both rank.
- `localReport` links each listing to Google Maps or its website and shows the rating and review count for the top 3.
- `aiReport` shows all of a topic's top sources with how many answers cite each.
- `rankReport` names the terms it couldn't compare.
- `baselineReport` lists every tracked term on comparison and same-data reports, shows total estimated visits and adds the position bands for all terms to the first baseline.
- `redirectReport` says why a request got no response and lists the pages sent to the homepage.

## 0.5.1 (2026-10-09)

### Changed

- `rankReport` shows each search's top 3 as links to their pages, and links the #1 result in what to do.

## 0.5.0 (2026-10-09)

### Added

- `rankCheck(client, input)`: where a domain ranks on Google for the terms you name, from a search run that day. Modes `queue`, `priority` and `live`; one cached result per term, shared across modes.
- `rankDiff(prev, next)`: terms gained, lost, improved, declined and unchanged between two rank checks, with each change in places.
- `rankReport(result, date, prev?)`: the report for a rank check, or for what moved since `prev`.
- `estimateRankCost`, `parseSerp`, `RANK_PRICES`, `DEFAULT_RANK_DEPTH` and `DEFAULT_RANK_MAX_KEYWORDS`, with the types `RankCheckInput`, `RankCheckResult`, `RankTerm`, `RankMode`, `RankDiff`, `RankMove` and `SerpResult`.
- `DataForSeoClient.cached` and `DataForSeoClient.queued`, both optional. `createDataForSeoClient` implements them. `queued` posts tasks in batches of `TASK_POST_LIMIT` (100), polls tasks_ready and fetches each result.
- `QueueTimeoutError`, with the `ids` of queued tasks that weren't ready in time, and `QueueOptions`.
- `DailyLimitError` takes an optional message.

### Changed

- The ranking baseline's comparison report is labeled "Ranking baseline", so it isn't confused with the rank check.

## 0.4.0 (2026-10-09)

### Changed

- `buildReport` drops table columns with no value in any row.

### Added

- `toMarkdown(blocks)`: GitHub-flavored Markdown for a report.
- `toHtml(blocks, { variant })`: an unstyled `<article>` with `dfs-` classes, or with `variant: 'page'` a standalone document with its own stylesheet for light, dark and print.
- `Renderer<T>`, the type for your own renderer.
- A named type for each block: `HeadingBlock`, `TextBlock`, `StatsBlock`, `TableBlock`, `CalloutBlock`, `ListBlock`, `DetailsBlock`, `ChartBlock` and `FooterBlock`. `Block` is their union, unchanged.
- `parseInline(text)` and the `Inline` type, to read the bold, code and links in block text.

## 0.3.0 (2026-10-09)

### Added

- `DataForSeoError`, thrown for API and task errors, with DataForSEO's `status` code and the `endpoint`. `DailyLimitError` extends it.
- Named input types for each check: `SnapshotInput`, `CandidatesInput`, `GapInput`, `LocalInput`, `AiInput` and `BaselineInput`, plus `Market`, `RelevanceOptions` and `Balance`.
- `createDiskSnapshotStore`, named to match `createDiskCacheStore`.
- Tests for every check, the path checks and the report builders, with no network calls.

### Changed

- API errors are `DataForSeoError` instead of a plain `Error`. Messages are the same.
- `competitorCandidates` returns the note "Pick the real competitors and pass them to competitorGap."
- `index.ts` lists every export by name. Nothing was removed.
- Every export has a doc comment.
- `check:dist` also fails on untracked files under `dist/`.

### Deprecated

- `createSnapshotStore`. It's an alias for `createDiskSnapshotStore`.

## 0.2.1 (2026-10-09)

- The install example points at the 0.2.1 tag.

## 0.2.0 (2026-10-09)

### Added

- `createHttpCacheStore`, a cache store on your own server: `GET` and `PUT` `{url}/{key}` with a bearer token. Errors and timeouts count as misses.

## 0.1.0 (2026-10-08)

First release.

- `createDataForSeoClient`, with a 7-day cache of paid responses and `createDiskCacheStore`.
- `DailyLimitError` when the account's daily spend limit is used up, and `dailyBudget` to read today's spend against it.
- Checks: `balance`, `seoSnapshot`, `competitorCandidates`, `competitorGap`, `localVisibility`, `aiVisibility`, `rankBaseline` and `backlinkRedirects`.
- Report builders for each check except `competitorCandidates`, and `buildReport` to turn a report into blocks.
