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
  ChannelPostHealth,
  ChannelPostState,
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
export { DELETED_USERNAME_PATTERN, ROLE_REFUSALS, forbidden, isDeletedMember } from './identity';
export type {
  ApiError,
  AuthUser,
  DeleteAccountRequest,
  ForgotPasswordRequest,
  LoginRequest,
  RefusedRole,
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
export {
  CONTRAST_PREFERENCES,
  MOTION_PREFERENCES,
  PRIVACY_VISIBILITIES,
  TEXT_SIZE_PREFERENCES,
  THEME_PREFERENCES,
} from './profile';
export type {
  ContrastPreference,
  MotionPreference,
  TextSizePreference,
  OwnProfile,
  PrivacySettings,
  PrivacyVisibility,
  ProfileView,
  PublicProfile,
  FirstRunResponse,
  FirstRunState,
  ThemePreference,
  UpdatePreferencesRequest,
  UpdatePrivacyRequest,
  UpdateProfileRequest,
} from './profile';
export {
  KNOCKOUT_ROUNDS,
  LEADERS_MINUTES_MAX,
  LEADERS_MINUTES_PRESETS,
  SUGGESTED_TEAMS_PER_COMPETITION,
  TEAM_AVERAGE_METRICS,
} from './catalog';
export type {
  CompetitionPage,
  CompetitionSummary,
  CompetitionsResponse,
  CountriesResponse,
  CountrySummary,
  FollowSuggestionsResponse,
  FormResult,
  KnockoutBracket,
  KnockoutLeg,
  KnockoutRound,
  KnockoutRoundKey,
  KnockoutTeam,
  KnockoutTie,
  Leader,
  LeadersFilter,
  LeaderBoards,
  BoardPlayer,
  AssistLeader,
  CleanSheetLeader,
  CardLeader,
  PlayerMatch,
  PlayerAvailability,
  PlayerAvailabilityListing,
  PlayerAvailabilityReason,
  PlayerPage,
  PlayerSeasonMinutes,
  PlayerSeasonRecord,
  PlayerSpell,
  SeasonFixture,
  SeasonSummary,
  SquadPlayer,
  SquadPosition,
  StageSummary,
  SuggestedCompetition,
  SuggestedTeam,
  TableContext,
  TableRow,
  TeamAverageMetric,
  TeamCompetition,
  TeamCompetitionSplits,
  TeamFixture,
  TeamPage,
  TeamManager,
  TeamPageFixture,
  TeamSplitRecord,
  TeamStatAverage,
  TeamSummary,
  TeamsResponse,
} from './catalog';
// The match centre's competition context (blueprint 4.2, T-840).
export type {
  CompetitionContext,
  CompetitionContextTable,
  CompetitionContextTie,
  ContextStanding,
} from './competition-context';
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
  ModelXiStrength,
  ModelForecastResponse,
  ModelForecastUnavailable,
  ModelEloSource,
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
  ForecastSummary,
  ForecastSummaryEntry,
  ForecastSummaryListResponse,
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
  MatchAbsence,
  MatchCentre,
  MatchHeader,
  MatchIncident,
  MatchIncidentKind,
  MatchLineupPlayer,
  MatchLineups,
  MatchPeriod,
  MatchPlayerStats,
  MatchStatMetric,
  MatchStatRow,
  MatchTeam,
  PlayerMatchMetric,
} from './match-centre';
// The match centre's key players (blueprint 4.2, T-841): a stated rule, not a judgement.
export { KEY_PLAYERS_PER_SIDE } from './key-players';
export type { KeyPlayer, KeyPlayerAvailability, KeyPlayers, KeyPlayersSide } from './key-players';
export {
  FRIEND_PREDICTIONS_DAYS,
  FRIEND_PREDICTIONS_LIMIT,
  MAX_EXPLANATION_LENGTH,
  MAX_REASON_TAGS,
  PREDICTION_REASON_TAGS,
} from './predictions';
export type {
  FixtureSettlementsResponse,
  FriendPrediction,
  FriendPredictionsResponse,
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
  ADMIN_ONLY_NOTIFICATION_KINDS,
  MATCH_ALERT_KINDS,
  MUTE_SCOPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_OF,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_HOURLY_CAP,
  NOTIFICATION_KINDS,
  NOTIFICATION_TEXT,
  QUIET_HOURS_EXEMPT,
  QUIET_HOURS_RULE,
  isMatchAlertKind,
  isNotificationKind,
  notificationLine,
  notificationPath,
} from './notifications';
export type {
  MatchAlertKind,
  MuteScope,
  Notification,
  NotificationCategory,
  NotificationKind,
  NotificationMute,
  NotificationPreference,
  NotificationSettings,
  NotificationSubject,
  PushState,
  PushSubscriptionRequest,
  PushUnsubscribeRequest,
  NotificationsResponse,
  QuietHours,
  SetNotificationPreferenceRequest,
  SetQuietHoursRequest,
} from './notifications';

// The public match discussion (blueprint 10.2, T-251). Reading is open and
// posting is granted, so the panel and the viewer's permission are separate
// shapes: a guest gets the first and the second does not apply to them.
export { PANEL_LATEST_BATCH, PANEL_LATEST_POSTS } from './match-panel';
export type {
  MatchPanelPage,
  PanelAuthor,
  PanelLatest,
  PanelLatestResponse,
  PanelLink,
  PanelLinkedIncident,
  PanelLinkedPrediction,
  PanelLinkKind,
  PanelLinkRequest,
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
  ContributorFlag,
  ContributorFlagClosure,
  ContributorFlagListResponse,
  ContributorGrant,
  ContributorListResponse,
  ContributorStatusResponse,
  EligibilityShortfall,
  DismissContributorFlagRequest,
  GrantContributorRequest,
  GrantEvent,
  GrantEventRequest,
  GrantStanding,
} from './contributor';
export type {
  Achievement,
  AchievementKind,
  AchievementRound,
  Achievements,
  AchievementsResponse,
  CareerPoints,
  CareerPointsResponse,
  CompetitionRating,
  EligibilityResponse,
  LeaderboardEntry,
  LeaderboardPeriod,
  LeaderboardPeriodKind,
  LeaderboardResponse,
  LeaderboardScope,
  PointsReason,
  PointsTransaction,
  PrivilegeEligibility,
  Rating,
  RatingComponents,
  RatingHistory,
  RatingHistoryPoint,
  RatingHistoryResponse,
  RatingResponse,
  RatingTier,
} from './reputation';
export { ACHIEVEMENT_KINDS, LEADERBOARD_PERIOD_KINDS, LEADERBOARD_SCOPES } from './reputation';
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
export { SEARCH_COMMUNITY_TYPES, SEARCH_ENTITY_TYPES, SEARCH_TYPES } from './search';
export type {
  GroupSearchResult,
  MemberSearchResult,
  SearchCommunityType,
  SearchEntityType,
  SearchResponse,
  SearchResult,
  SearchType,
  StorySearchResult,
} from './search';

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
  GROUP_DISCUSSIONS_HOURS,
  GROUP_DISCUSSIONS_LIMIT,
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
  GroupDiscussionsResponse,
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
  MAX_OPEN_POLLS,
  MAX_POLL_OPTION,
  MAX_POLL_OPTIONS,
  MAX_POLL_QUESTION,
  MAX_POLL_REMOVAL_REASON,
  MIN_GROUP_NAME,
  MIN_POLL_OPTIONS,
  POLL_DEFAULT_HOURS,
  POLL_MAX_HOURS,
  POLL_MIN_HOURS,
} from './groups';
export type {
  CreateGroupPollRequest,
  CreateGroupRequest,
  Group,
  GroupPoll,
  GroupPollOption,
  GroupPollResponse,
  GroupPollsResponse,
  GroupPollVoteRequest,
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
  RemoveGroupPollRequest,
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
  BREAKING_STRIP_LIMIT,
  BREAKING_WINDOW_HOURS,
  FIXTURE_NEWS_LIMIT,
  ENTITY_NEWS_LIMIT,
  NEWS_PAGE_SIZE,
  NEWS_SECTIONS,
  SAVED_ARTICLES_LIMIT,
  STORY_LABEL_ORIGINS,
  STORY_TYPES,
  TRENDING_WEIGHTS,
  TRENDING_WINDOW_HOURS,
  isNewsSection,
  isStoryType,
} from './news';
export type {
  BreakingClearRequest,
  BreakingListResponse,
  BreakingMark,
  BreakingMarkRequest,
  BreakingNewsResponse,
  BreakingRecord,
  DebateClearRequest,
  DebateListResponse,
  DebateRecord,
  DebateSelectionRequest,
  FixtureNewsReason,
  FixtureNewsResponse,
  EntityNewsReason,
  EntityNewsResponse,
  NewsEntity,
  NewsFilters,
  NewsRights,
  NewsSection,
  NewsSectionReason,
  NewsReport,
  NewsSectionResponse,
  NewsStoryCard,
  SavedArticle,
  SavedArticleState,
  SavedArticlesResponse,
  ReviewState,
  StoryLabelOrigin,
  StoryPage,
  StoryType,
  StoryTypeLabel,
  StoryTypeRequest,
  StoryVersion,
  TranslationRequest,
  VersionOrigin,
} from './news';
// The intelligence layer (Phase 5, D-070): a language model behind one port,
// its honest absence, and the labelled shape of anything a machine wrote.
export type {
  AskReason,
  AskResponse,
  Briefing,
  BriefingDay,
  BriefingDigest,
  BriefingNotice,
  BriefingOutcome,
  BriefingReason,
  BriefingResponse,
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
export type {
  Audience,
  AudienceFilter,
  AudienceFollowType,
  AudiencesResponse,
  Campaign,
  CampaignDispatch,
  CampaignsResponse,
  CreateAudienceRequest,
  CreateCampaignRequest,
  SendCampaignRequest,
} from './campaigns';
export { AUDIENCE_FOLLOW_TYPES } from './campaigns';
// The watchdog over the health views (T-801): conditions, thresholds, transitions.
export { WATCHDOG_LEVELS } from './watchdog';
export type {
  AdminAlertsReport,
  AlertChannelOutcomes,
  AlertDelivery,
  WatchdogCondition,
  WatchdogEvent,
  WatchdogEventKind,
  WatchdogFreshness,
  WatchdogLevel,
  WatchdogReport,
  WatchdogThreshold,
  WatchdogUnit,
} from './watchdog';
// Data-quality checks over the stored feed (T-820) and their admin page (T-821).
export { DATA_QUALITY_CHECKS } from './data-quality';
export type {
  DataQualityCheck,
  DataQualityCheckState,
  DataQualityCount,
  DataQualityFinding,
  DataQualityFixtureRef,
  DataQualityReport,
  RefetchDataQualityRequest,
  RefetchDataQualityResponse,
  ReviewDataQualityBatchRequest,
  ReviewDataQualityBatchResponse,
  ReviewDataQualityFindingRequest,
} from './data-quality';
// API errors and job failures counted per hour (T-803).
export { FAILURE_RETENTION_DAYS } from './failure-counts';
export type {
  FailureBucket,
  FailureCountsReport,
  JobFailureKind,
  QueueFailures,
  RouteErrors,
} from './failure-counts';
// Activity counts per UTC day for the admin console (T-807).
export { ACTIVITY_DEFAULT_DAYS, ACTIVITY_MAX_DAYS, ACTIVITY_METRICS } from './activity';
export type { ActivityGroup, ActivityMetric, ActivityReport, ActivitySeries } from './activity';
// The rate-limit inventory and refusals per day (T-811).
export { RATE_REFUSAL_DAYS, RATE_REFUSAL_RETENTION_DAYS } from './rate-limits';
export type {
  RateLimitCeiling,
  RateLimitEnforcement,
  RateLimitExemption,
  RateLimitSubject,
  RateLimitsReport,
  RateRefusalDay,
} from './rate-limits';
