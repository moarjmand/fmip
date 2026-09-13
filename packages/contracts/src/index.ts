export { COVERAGE_STATES, hasData, isCoverageState } from './coverage';
export type { CoverageState, Covered } from './coverage';

// The founder's analysis (blueprint 6.5, T-130). One of three prediction
// products, and deliberately sharing no type with the other two (rule 6).
export type {
  FounderAnalysesResponse,
  FounderAnalysis,
  FounderAnalysisResponse,
  FounderAnalysisSummary,
  FounderAnalysisVersion,
  FounderConfidence,
  FounderOutcome,
} from './founder-analysis';

// Community consensus (blueprint 6.6, T-134). The third of the three
// prediction products, sharing no type with the other two (rule 6).
export { MAX_CONSENSUS_FIXTURES, MIN_CONSENSUS_SAMPLE } from './consensus';
export type {
  CommunityConsensus,
  CommunityConsensusResponse,
  ConsensusListEntry,
  ConsensusListResponse,
  ConsensusOutcome,
  ConsensusShares,
  CrowdDistribution,
  WeightedDistribution,
} from './consensus';

// The Power Index (blueprint 6.1, T-110).
export { POWER_INDEX_COMPONENTS, POWER_INDEX_LABELS, POWER_INDEX_WEIGHTS } from './power-index';
export type {
  PowerIndex,
  PowerIndexComponent,
  PowerIndexComponentValue,
  PowerIndexPair,
  PowerIndexResponse,
} from './power-index';
export type {
  HealthReport,
  IngestRun,
  IngestRunStatus,
  IngestionHealth,
  LiveHealth,
} from './health';
export type {
  ApiError,
  AuthUser,
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
  SessionResponse,
  VerifyEmailRequest,
} from './identity';
export { PRIVACY_VISIBILITIES } from './profile';
export type {
  OwnProfile,
  PrivacySettings,
  PrivacyVisibility,
  ProfileView,
  PublicProfile,
  UpdatePrivacyRequest,
  UpdateProfileRequest,
} from './profile';
export type {
  CompetitionPage,
  CompetitionSummary,
  CompetitionsResponse,
  CountriesResponse,
  CountrySummary,
  FormResult,
  Leader,
  PlayerMatch,
  PlayerPage,
  PlayerSeasonRecord,
  PlayerSpell,
  SeasonFixture,
  SeasonSummary,
  SquadPlayer,
  SquadPosition,
  StageSummary,
  TableContext,
  TableRow,
  TeamCompetition,
  TeamFixture,
  TeamPage,
  TeamSummary,
  TeamsResponse,
} from './catalog';
export { FOLLOWED_ENTITY_TYPES } from './following';
export type {
  FavouriteIds,
  FollowRequest,
  FollowedEntity,
  FollowedEntityType,
  FollowingResponse,
} from './following';
export type {
  ModelExpectedGoals,
  ModelForecastAvailable,
  ModelForecastRequest,
  ModelForecastResponse,
  ModelForecastUnavailable,
  ModelHealth,
  ModelInputs,
  ModelLeadingFactor,
  ModelLeadingFactorKind,
  ModelProbabilities,
  ModelScorelineProbability,
  ModelUnavailableReason,
} from './forecast';
export { MAX_FORECAST_FIXTURES } from './forecast';
export type {
  ForecastKind,
  ForecastListEntry,
  ForecastListResponse,
  ForecastUnavailableReason,
  ForecastVersion,
  ForecastVersionsResponse,
} from './forecast';
export type {
  FixtureEvaluationsResponse,
  ForecastEvaluation,
  MatchOutcome,
  ModelPerformanceResponse,
  ModelPerformanceRow,
} from './forecast';
export { STALE_LIVE_AFTER_MS } from './scores';
export type {
  FixtureStatus,
  Freshness,
  ScoreCard,
  ScoreCardIncident,
  ScoreCardIncidentKind,
  ScoreCardTeam,
  ScoreLine,
  ScoresAgeFilter,
  ScoresFilters,
  ScoresGroup,
  ScoresResponse,
} from './scores';
export type {
  CoverageModule,
  FormEntry,
  HeadToHeadEntry,
  MatchCentre,
  MatchHeader,
  MatchIncident,
  MatchIncidentKind,
  MatchLineupPlayer,
  MatchLineups,
  MatchPeriod,
  MatchStatMetric,
  MatchStatRow,
  MatchTeam,
} from './match-centre';
export { MAX_EXPLANATION_LENGTH, MAX_REASON_TAGS, PREDICTION_REASON_TAGS } from './predictions';
export type {
  FixtureSettlementsResponse,
  Prediction,
  PredictionOutcome,
  PredictionReasonTag,
  PredictionResponse,
  PredictionVersion,
  Settlement,
  SettlementRunResponse,
  SettlementVoidReason,
  SubmitPredictionRequest,
  PredictionHistoryFixture,
  PredictionHistoryItem,
  PredictionHistoryResponse,
} from './predictions';
export type {
  CareerPoints,
  CareerPointsResponse,
  EligibilityResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  PointsReason,
  PointsTransaction,
  PrivilegeEligibility,
  Rating,
  RatingComponents,
  RatingResponse,
  RatingTier,
} from './reputation';
export type {
  AccountStatus,
  AdminOverview,
  AdminUser,
  AdminUsersResponse,
  AuditRecord,
  AuditResponse,
  CoverageStatusRow,
  FreshnessRow,
  RatingConfig,
  SetCoverageRequest,
  SetUserStatusRequest,
} from './admin';
export { SEARCH_ENTITY_TYPES } from './search';
export type { SearchEntityType, SearchResponse, SearchResult } from './search';

// The social graph (blueprint 8.1, T-200). Contact only: nothing here imports a
// prediction, a forecast or an analysis.
export type {
  BlockedMember,
  BlocksResponse,
  Friend,
  FriendRequest,
  FriendRequestsResponse,
  FriendStatus,
  FriendStatusResponse,
  FriendsResponse,
  SocialMember,
} from './social';

// Moderation (blueprint 10.4 and 16, T-210, D-053). Every list is short on
// purpose and grows only when something enforces the next entry.
export {
  MODERATION_OUTCOMES,
  REPORT_REASONS,
  REPORT_SUBJECTS,
  SANCTION_SCOPES,
} from './moderation';
export type {
  AppealNote,
  DecideRequest,
  LiftSanctionRequest,
  MemberModerationHistory,
  ModerationDecision,
  ModerationQueueResponse,
  ModerationOutcome,
  OwnStandingResponse,
  Report,
  ReportReason,
  ReportSubject,
  QueueSubject,
  QueuedReport,
  Sanction,
  SanctionRequest,
  SanctionScope,
  SubmitReportRequest,
} from './moderation';

// Conversations (blueprint 8.3, T-220). Ordered by sequence, never by clock.
export {
  CARD_KINDS,
  CONVERSATION_KINDS,
  MAX_MESSAGE_LENGTH,
  MESSAGE_PAGE_SIZE,
  MIN_SEARCH_TERM,
  SEARCH_RESULT_LIMIT,
} from './conversations';
export type {
  CardKind,
  ConversationKind,
  ConversationSearchResponse,
  ConversationMember,
  ConversationPage,
  ConversationSummary,
  ConversationsResponse,
  Message,
  MessageRemoval,
  SendMessageRequest,
  SendMessageResponse,
  SharedCard,
} from './conversations';
