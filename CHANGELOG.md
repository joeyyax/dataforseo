# Changelog

## 0.4.0 (2026-10-09)

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
