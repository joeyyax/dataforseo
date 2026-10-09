# Changelog

## 0.5.0 (2026-10-09)

### Added

- `rankCheck(client, input)`: where a domain ranks on Google for the terms you name, from a search run that day. Modes `queue`, `priority` and `live`; one cached result per term, shared across modes.
- `rankDiff(prev, next)`: terms gained, lost, improved, declined and unchanged between two rank checks, with each change in places.
- `rankReport(result, date, prev?)`: the report for a rank check, or for what moved since `prev`.
- `estimateRankCost`, `parseSerp`, `RANK_PRICES`, `DEFAULT_RANK_DEPTH` and `DEFAULT_RANK_MAX_KEYWORDS`, with the types `RankCheckInput`, `RankCheckResult`, `RankTerm`, `RankMode`, `RankDiff`, `RankMove` and `SerpResult`.
- `DataForSeoClient.cached` and `DataForSeoClient.queued`, both optional. `createDataForSeoClient` implements them. `queued` posts tasks in batches of `TASK_POST_LIMIT` (100), polls tasks_ready and fetches each result.
- `QueueTimeoutError`, with the `ids` of queued tasks that weren't ready in time, and `QueueOptions`.
- `DailyLimitError` takes an optional message.

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
