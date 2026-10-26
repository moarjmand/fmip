// The provider-neutral model every adapter produces.
export * from './normalised';
export { foldCountry } from './country-name';
// How often transfers are asked for again (T-1440, D-231).
export {
  TRANSFERS_REFRESH_DAYS_IN_WINDOW,
  TRANSFERS_REFRESH_DAYS_OUTSIDE,
  inTransferWindow,
  transfersRefreshDays,
} from './transfer-window';

// The adapter contract.
export {
  ADAPTER_CALLS,
  type AdapterCall,
  type AdapterConfig,
  type AdapterError,
  type AdapterErrorKind,
  type AdapterFactory,
  type AdapterManifest,
  type AdapterResult,
  type FixtureQuery,
  type LiveQuery,
  type ProviderAdapter,
  type StandingsQuery,
  type Transport,
  type TransportInit,
  type TransportResponse,
} from './adapters/_contract';

// A publisher's feed, read by hand and only as far as D-061 permits (T-142).
export {
  type FeedOptions,
  type FeedProblem,
  type ParsedFeed,
  decodeEntities,
  parseFeed,
  readFeed,
} from './news/feed';
// GNews, an English news search that names each article's own publisher (T-1367, D-185).
export {
  GNEWS_MAX_ARTICLES,
  GNEWS_SEARCHES,
  GNEWS_SOCCER_QUERY,
  GNEWS_UK_FOOTBALL_QUERY,
  type GNewsItem,
  type GNewsOptions,
  type GNewsPublisher,
  type GNewsQuery,
  type GNewsSearch,
  type ParsedGNews,
  articleUrlKey,
  gnewsSearchFor,
  gnewsUrl,
  parseGNews,
  readGNews,
  siteHost,
} from './news/gnews';
// Items about another sport that shares the word "football" (T-1400, D-215).
export {
  OTHER_CODE_RULES,
  type OtherCode,
  type OtherCodeRule,
  otherCodeOf,
} from './news/other-code';
// Items whose own headline says they are not articles (T-1396, D-211).
export {
  NON_ARTICLE_RULES,
  type NonArticleKind,
  type NonArticleRule,
  nonArticleKind,
} from './news/non-article';
export {
  type ProvenanceInput,
  type ProvenanceVerdict,
  hostIsUnder,
  judgeProvenance,
} from './news/image-provenance';
export {
  IMAGE_MAX_BYTES,
  type ImageContentType,
  type SniffResult,
  type SniffedImage,
  sniffImage,
} from './news/image-file';

// The recorded-fixture contract harness.
export {
  checkAdapterContract,
  loadScenarios,
  parseScenario,
  type ContractProblem,
  type Scenario,
} from './harness/contract-check';
export {
  RecordingTransport,
  ReplayTransport,
  type RecordedRequest,
} from './harness/replay-transport';
export {
  type Problem,
  validateFixture,
  validateFixtureDetail,
  validateIncident,
  validateLineup,
  validateManifest,
  validateStanding,
} from './harness/validate';

// Adapters. One directory each; verified by their recordings, not their authors.
// A provider's incident detail in our words, also for a row stored before T-1378.
export { incidentDetail } from './adapters/_incident-detail';
// An absence's reason in our words, also for a row stored before T-1601.
export { absenceReason } from './adapters/_absence-reason';
export { API_FOOTBALL_MANIFEST, createApiFootballAdapter } from './adapters/api-football';
export {
  FOOTBALL_DATA_ORG_MANIFEST,
  createFootballDataOrgAdapter,
} from './adapters/football-data-org';
export { HIGHLIGHTLY_MANIFEST, createHighlightlyAdapter } from './adapters/highlightly';
// Highlightly's verified highlights and where each may be watched (T-1366, D-184).
export {
  HIGHLIGHTS_PAGE_SIZE,
  type HighlightEntityRef,
  type HighlightGeo,
  type HighlightSkip,
  type HighlightlyHighlights,
  type HighlightsPage,
  type HighlightsQuery,
  type NormalisedHighlight,
  createHighlightlyHighlights,
  mapGeo,
  mapHighlight,
  mapHighlightsPage,
} from './adapters/highlightly/highlights';
// Highlightly's per-player expected goals, a source of its own (T-1432, D-224).
export {
  type BoxScoreMatch,
  type BoxScoreMatchesQuery,
  type BoxScoreRef,
  EXPECTED_METRICS,
  type ExpectedMetric,
  type HighlightlyBoxScores,
  type NormalisedBoxScore,
  type NormalisedBoxScorePlayer,
  type NormalisedBoxScoreSide,
  createHighlightlyBoxScores,
  mapBoxScore,
  mapBoxScoreMatch,
  mapBoxScorePlayer,
} from './adapters/highlightly/box-score';

// The replay source (T-026, D-049): a real adapter over committed recordings.
export {
  REPLAY_FIXTURE,
  REPLAY_QUERY,
  createReplayAdapter,
  recordingsDir,
  replayAvailable,
  replayTransport,
} from './adapters/replay';

// The bake-off (T-024).
export {
  disagreements,
  fixtureCompleteness,
  matchKey,
  normaliseTeamName,
  type Completeness,
  type Disagreement,
} from './bakeoff/metrics';
export {
  NOT_MEASURED,
  TimedTransport,
  runLive,
  runRecorded,
  type BakeoffResult,
  type CallRecord,
  type CompetitionPlan,
  type LivePlan,
  type ProviderSummary,
} from './bakeoff/run';
export { END_MARKER, START_MARKER, insertResults, renderMarkdown } from './bakeoff/report';
