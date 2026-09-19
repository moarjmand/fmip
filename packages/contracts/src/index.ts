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

// Community-written match analysis (blueprint 10.3, T-260). A **fourth** signed
// opinion, sharing no type with the three prediction products rule 6 names --
// the resemblance to the founder's analysis is exactly the danger.
export type {
  CommunityAnalysesResponse,
  CommunityAnalysis,
  CommunityAnalysisContent,
  CommunityAnalysisState,
  CommunityAnalysisVersion,
  CommunityAnalysisWorkspace,
  CommunityAnalyst,
  CommunityConfidence,
  CommunityOutcome,
  CommunityReview,
  CommunitySubmission,
  ReviewAnalysisRequest,
  SaveAnalysisDraftRequest,
} from './community-analysis';

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
  ChatBusState,
  ChatHealth,
  DeliveryChannelState,
  DeliveryHealth,
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
// The viewer's territory (blueprint 11, T-312): chosen, stored, never inferred.
export { TERRITORY_CODE } from './territory';
export type {
  SetViewingTerritoryRequest,
  TerritoriesResponse,
  Territory,
  ViewingTerritory,
  ViewingTerritoryResponse,
} from './territory';
// Watch and highlights (blueprint 11, T-311): per territory, under the rights
// each source grants; "not supplied" and "not available" kept apart by shape.
export {
  BROADCASTER_KINDS,
  VIEWING_ACCESS,
  VIEWING_COVERAGE_STATES,
  VIEWING_MODULES,
  VIEWING_RIGHTS,
} from './viewing';
export type {
  Broadcaster,
  BroadcasterKind,
  BroadcasterRequest,
  BroadcasterResponse,
  BroadcastersResponse,
  Highlight,
  HighlightRequest,
  MatchViewing,
  ViewingAccess,
  ViewingBatchResponse,
  ViewingCoverageRecord,
  ViewingCoverageRequest,
  ViewingCoverageResponse,
  ViewingCoverageState,
  ViewingModule,
  ViewingOption,
  ViewingOptionRequest,
  ViewingOptionResponse,
  ViewingRemovalRequest,
  ViewingRights,
  ViewingSource,
} from './viewing';
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
// The Following feed (blueprint 12.1, T-333): ranked from qualified signals,
// never raw volume, and saying what it is showing.
export { FEED_RANKING_VERSION, FEED_SIGNALS } from './following-feed';
export type {
  FeedFixture,
  FeedFounderAnalysis,
  FeedItem,
  FeedItemBody,
  FeedPanelPost,
  FeedSignal,
  FeedSignalKind,
  FeedStory,
  FollowingFeed,
  FollowingFeedReason,
} from './following-feed';
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
  GroupPredictionCall,
  GroupPredictionComparison,
  GroupPredictionComparisonResponse,
  Prediction,
  PredictionHistoryFixture,
  PredictionHistoryItem,
  PredictionHistoryResponse,
  PredictionOutcome,
  PredictionReasonTag,
  PredictionResponse,
  PredictionVersion,
  Settlement,
  SettlementRunResponse,
  SettlementVoidReason,
  SubmitPredictionRequest,
} from './predictions';
// Deciding which matches have a public discussion (blueprint 10.2, T-253).
// An operator decides, and every shape here carries a required reason.
export type { PanelDecisionRequest, PanelListResponse, PanelRecord } from './panel-admin';

// Reacting to a panel post and following a contributor (blueprint 10.2, T-252).
// Both open to any member, and neither a way to post: a reaction is one of six
// named values and a follow carries nothing at all.
export { PANEL_REACTIONS, isPanelReaction } from './panel-social';
export type {
  FollowStatus,
  FollowedMember,
  FollowedMembersResponse,
  MyPostReactions,
  PanelReaction,
  PanelReactionTally,
} from './panel-social';

// In-product notifications (blueprint 12.2, T-270). The defaults live here and
// nowhere else: "a missing preference row means the documented default" is only
// true while the document and the code are the same thing.
export {
  MUTE_SCOPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_OF,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_HOURLY_CAP,
  NOTIFICATION_KINDS,
  QUIET_HOURS_RULE,
  isNotificationKind,
} from './notifications';
export type {
  MuteScope,
  Notification,
  NotificationCategory,
  NotificationKind,
  NotificationMute,
  NotificationPreference,
  NotificationSettings,
  NotificationSubject,
  NotificationsResponse,
  QuietHours,
  SetNotificationPreferenceRequest,
  SetQuietHoursRequest,
} from './notifications';

// The public match discussion (blueprint 10.2, T-251). Reading is open and
// posting is granted, so the panel and the viewer's permission are separate
// shapes: a guest gets the first and the second does not apply to them.
export type {
  MatchPanelPage,
  PanelAuthor,
  PanelPermission,
  PanelPost,
  PanelRefusal,
  PanelState,
  SubmitPanelPostRequest,
} from './match-panel';

// Approval to post on a public panel (blueprint 9.4 and 10.2, T-250). Computed
// eligibility and a granted privilege are separate types on purpose: nothing
// here lets one become the other.
export type {
  ContributorCandidate,
  ContributorEligibility,
  ContributorGrant,
  ContributorListResponse,
  ContributorStatusResponse,
  EligibilityShortfall,
  GrantContributorRequest,
  GrantEvent,
  GrantEventRequest,
  GrantStanding,
} from './contributor';
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
  REACTIONS,
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
  FixtureCard,
  GroupThreadsResponse,
  Message,
  MessageRemoval,
  Reaction,
  ReactionCount,
  OpenThreadRequest,
  SendMessageRequest,
  SendMessageResponse,
  SharedCard,
} from './conversations';

// Groups (blueprint 8.2 and the exclusive groups of 10.1, T-240). Three
// visibilities, because "found but not read" is the case a boolean would lose.
export {
  GROUP_ROLES,
  GROUP_SLUG_PATTERN,
  GROUP_STANDINGS,
  GROUP_VISIBILITIES,
  MAX_GROUP_DESCRIPTION,
  MAX_GROUP_NAME,
  MAX_JOIN_NOTE,
  MIN_GROUP_NAME,
} from './groups';
export type {
  CreateGroupRequest,
  Group,
  GroupInvite,
  GroupInvitesResponse,
  GroupJoinRequest,
  GroupJoinRequestsResponse,
  GroupMember,
  GroupResponse,
  GroupRole,
  GroupStanding,
  GroupSummary,
  GroupVisibility,
  GroupsResponse,
  JoinGroupRequest,
  SetGroupRoleRequest,
  UpdateGroupRequest,
} from './groups';

// The chat socket (blueprint 8.3, T-230). Delivery only: everything a member
// can change stays on the HTTP surface above.
export { CHAT_CLOSE, CHAT_SOCKET_PATH } from './chat-socket';
export type {
  ChatClientFrame,
  ChatCloseCode,
  ChatDropReason,
  ChatEvent,
  ChatRefusal,
  ChatServerFrame,
} from './chat-socket';

// News (blueprint 3.1 and 3.3, T-143). A story is its promoted original and a
// link back to the publisher; each section says what it is computed from.
export {
  FIXTURE_NEWS_LIMIT,
  NEWS_PAGE_SIZE,
  NEWS_SECTIONS,
  TRENDING_WINDOW_HOURS,
  isNewsSection,
} from './news';
export type {
  DebateClearRequest,
  DebateListResponse,
  DebateRecord,
  DebateSelectionRequest,
  FixtureNewsReason,
  FixtureNewsResponse,
  NewsEntity,
  NewsFilters,
  NewsRights,
  NewsSection,
  NewsSectionReason,
  NewsReport,
  NewsSectionResponse,
  NewsStoryCard,
  ReviewState,
  StoryPage,
  StoryVersion,
  TranslationRequest,
  VersionOrigin,
} from './news';
// The intelligence layer (Phase 5, D-070): a language model behind one port,
// its honest absence, and the labelled shape of anything a machine wrote.
export type {
  AskReason,
  AskResponse,
  IntelligenceHealth,
  LanguageModelState,
  MachineText,
  MatchSummary,
  MatchSummaryOutcome,
  MatchSummaryReason,
  MatchSummaryRequest,
  MatchSummaryResponse,
  SearchIntent,
  ModerationSuggestion,
  SuggestedCategory,
  SuggestionOutcome,
  SummaryGrounding,
} from './intelligence';
