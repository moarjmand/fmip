// The provider-neutral model every adapter produces.
export * from './normalised';

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
export { type FeedProblem, type ParsedFeed, parseFeed, readFeed } from './news/feed';

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
export { API_FOOTBALL_MANIFEST, createApiFootballAdapter } from './adapters/api-football';
export {
  FOOTBALL_DATA_ORG_MANIFEST,
  createFootballDataOrgAdapter,
} from './adapters/football-data-org';
export { HIGHLIGHTLY_MANIFEST, createHighlightlyAdapter } from './adapters/highlightly';

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
