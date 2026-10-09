// Client and cache
export {
  createDataForSeoClient, cacheKey, costLimitMessage, nextUtcMidnight, DataForSeoError, DailyLimitError, QueueTimeoutError,
  DAILY_LIMIT_STATUS, DEFAULT_TIMEOUT_MS, DEFAULT_TTL_MS, TASK_POST_LIMIT,
} from './client.js';
export type { Charged, DataForSeoClient, DataForSeoOptions, QueueOptions } from './client.js';
export { createDiskCacheStore, createHttpCacheStore } from './cache.js';
export type { CacheStore, HttpCacheStoreOptions } from './cache.js';

// Checks
export {
  balance, dailyBudget, seoSnapshot, competitorCandidates, competitorGap, localVisibility, aiVisibility, rankBaseline,
  combine, daySpend, isNoiseCompetitor, matchesBusiness, mergeGaps, parseMapsItems, parseRankedItem, sameSite, topPages,
  DEFAULT_BASELINE_LIMIT, DEFAULT_CANDIDATES, DEFAULT_GAP_LIMIT, DEFAULT_LANGUAGE, DEFAULT_LOCATION, DEFAULT_MAX_KEYWORDS,
  DEFAULT_PROMPTS, DEFAULT_SNAPSHOT_LIMIT, DISCOVERY_KEYWORDS, GAP_MAX_POSITION, MAPS_DEPTH,
} from './checks.js';
export type {
  AiInput, AiPrompt, AiResult, AiTopic, Balance, BaselineInput, BaselineResult, CandidatesInput, CandidatesResult,
  ClassifiedKeyword, CompetitorCandidate, DailyBudget, DiscoveryKeyword, GapCompetitor, GapInput, GapKind, GapPull,
  GapResult, GapTerm, LocalInput, LocalResult, MapsListing, Market, MentionCounts, Positions, RelevanceInput,
  RelevanceOptions, SnapshotInput, SnapshotResult, Spend,
} from './checks.js';
export { backlinkRedirects, firstLocation, groupByPath, isGated, mapToOrigin, sortWorstFirst, stripTracking, verdictFor, DEFAULT_REDIRECT_LIMIT } from './redirects.js';
export type { BacklinkRedirectsInput, BacklinkRedirectsResult, PathCheck, PathTarget, RedirectVerdict } from './redirects.js';

// Rank check
export { estimateRankCost, parseSerp, rankCheck, rankDiff, DEFAULT_RANK_DEPTH, DEFAULT_RANK_MAX_KEYWORDS, RANK_PRICES } from './rank.js';
export type { RankCheckInput, RankCheckResult, RankDiff, RankMode, RankMove, RankTerm, SerpResult } from './rank.js';

// Snapshots
export { createDiskSnapshotStore, createSnapshotStore, diffSnapshots, snapshotId, snapshotLimit, trimSnapshot } from './snapshots.js';
export type { KeywordMove, RankedKeyword, RankSnapshot, SnapshotDiff, SnapshotStore } from './snapshots.js';

// Relevance
export { classify, domainStem, elsewhere, intentOf, isBrandKeyword, mentions, parseTopics, relevanceFor, squash, US_PLACES } from './relevance.js';
export type { Classified, Relevance, TermKind, Topic } from './relevance.js';

// Reports
export {
  aiReport, baselineReport, gapReport, localReport, rankReport, redirectReport, snapshotReport,
  chain, funnels, snapshotOpportunities, GLOSSARY,
} from './reports.js';
export { buildReport, capitalize, code, count, day, every, longDate, percent, plural, series, theTop, times, tonesFor, usd } from './report.js';
export type {
  BadgeTone, Block, CalloutBlock, ChartBlock, DetailsBlock, FooterBlock, HeadingBlock, ListBlock, MethodLine, Renderer,
  ReportSpec, StatItem, StatsBlock, TableBlock, TableColumn, Terms, TextBlock, Tone,
} from './report.js';

// Renderers
export { toMarkdown } from './markdown.js';
export { toHtml } from './html.js';
export type { HtmlOptions } from './html.js';
export { parseInline } from './inline.js';
export type { Inline } from './inline.js';

// Utilities
export { mapLimit, money, normalizeDomain } from './util.js';
