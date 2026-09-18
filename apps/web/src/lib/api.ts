import type {
  AdminOverview,
  AdminUsersResponse,
  ApiError,
  AuditResponse,
  BlocksResponse,
  ChatHealth,
  CommunityConsensusResponse,
  CompetitionPage,
  CompetitionsResponse,
  ConsensusListResponse,
  ConversationPage,
  ConversationSearchResponse,
  ConversationsResponse,
  CountriesResponse,
  FixtureEvaluationsResponse,
  FollowedEntity,
  FollowingResponse,
  ForecastListResponse,
  ForecastVersionsResponse,
  FounderAnalysesResponse,
  FounderAnalysisResponse,
  FollowedMembersResponse,
  FriendRequestsResponse,
  FriendStatusResponse,
  FriendsResponse,
  GroupInvitesResponse,
  GroupJoinRequestsResponse,
  GroupPredictionComparisonResponse,
  GroupResponse,
  GroupsResponse,
  HealthReport,
  IngestionHealth,
  LeaderboardResponse,
  LiveHealth,
  CommunityAnalysesResponse,
  CommunityAnalysisWorkspace,
  CommunitySubmission,
  MatchCentre,
  DebateListResponse,
  MatchPanelPage,
  NewsSectionResponse,
  NotificationSettings,
  NotificationsResponse,
  OwnProfile,
  PanelPermission,
  PlayerPage,
  PowerIndexResponse,
  PredictionHistoryResponse,
  PredictionResponse,
  ProfileView,
  RatingResponse,
  ScoresResponse,
  SearchResponse,
  SessionResponse,
  TeamPage,
  TeamsResponse,
} from '@fmip/contracts';
import { withLocale } from '@/lib/locale-query';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';

/**
 * The API's own reachability, as seen from the web app.
 *
 * `unreachable` is a state, not an error to swallow: rule 3 says a missing
 * answer is labelled, never faked. The caller renders the difference.
 */
export type ApiHealth = { reachable: true; report: HealthReport } | { reachable: false };

/** `GET /admin/overview` (T-070): the operator's view; 401/403 come back as results. */
export function fetchAdminOverview(cookie: string | undefined): Promise<ApiResult<AdminOverview>> {
  return apiRequest<AdminOverview>('/admin/overview', cookie === undefined ? {} : { cookie });
}

/** `GET /admin/users?q=` (T-070). */
export function fetchAdminUsers(
  query: string,
  cookie: string | undefined,
): Promise<ApiResult<AdminUsersResponse>> {
  return apiRequest<AdminUsersResponse>(
    `/admin/users?q=${encodeURIComponent(query)}`,
    cookie === undefined ? {} : { cookie },
  );
}

/** `GET /admin/audit` (T-070), newest first. */
export function fetchAudit(cookie: string | undefined): Promise<ApiResult<AuditResponse>> {
  return apiRequest<AuditResponse>('/admin/audit', cookie === undefined ? {} : { cookie });
}

/** The group directory: public and discoverable only (blueprint 8.2, T-242). */
export function fetchGroups(
  term: string,
  cookie: string | undefined,
): Promise<ApiResult<GroupsResponse>> {
  const query = term === '' ? '' : `?q=${encodeURIComponent(term)}`;
  return apiRequest<GroupsResponse>(`/groups${query}`, cookie === undefined ? {} : { cookie });
}

/** One group. 404 covers "no such group" and "you may not know it is there". */
export function fetchGroup(
  slug: string,
  cookie: string | undefined,
): Promise<ApiResult<GroupResponse>> {
  return apiRequest<GroupResponse>(
    `/groups/${encodeURIComponent(slug)}`,
    cookie === undefined ? {} : { cookie },
  );
}

export function fetchMyGroups(cookie: string | undefined): Promise<ApiResult<GroupsResponse>> {
  return apiRequest<GroupsResponse>('/me/groups', cookie === undefined ? {} : { cookie });
}

/**
 * The public match discussion (T-251).
 *
 * **No cookie.** Reading is open to everybody, and sending a session here would
 * make the response viewer-specific for no reason — the panel is the same
 * document for a guest and for a contributor, and only `fetchPanelPermission`
 * differs between them.
 */
export function fetchMatchPanel(
  fixtureId: string,
  cursor?: string,
): Promise<ApiResult<MatchPanelPage>> {
  const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
  return apiRequest<MatchPanelPage>(`/fixtures/${fixtureId}/panel${query}`);
}

/**
 * Whom the viewer follows (T-252), fetched once for a whole page.
 *
 * One request and a set of usernames, rather than a follow-status call per
 * author: a panel with a dozen contributors on it would otherwise cost a dozen
 * round trips to draw a dozen buttons.
 */
export function fetchFollowedMembers(
  cookie: string | undefined,
): Promise<ApiResult<FollowedMembersResponse>> {
  return apiRequest<FollowedMembersResponse>(
    '/me/followed-members',
    cookie === undefined ? {} : { cookie },
  );
}

/** The viewer's inbox (T-272). Needs a session; there is no reading anybody else's. */
export function fetchNotifications(
  cookie: string | undefined,
  limit?: number,
): Promise<ApiResult<NotificationsResponse>> {
  const query = limit === undefined ? '' : `?limit=${String(limit)}`;
  return apiRequest<NotificationsResponse>(
    `/me/notifications${query}`,
    cookie === undefined ? {} : { cookie },
  );
}

/** Every kind with the value in force, plus the quiet window. */
export function fetchNotificationSettings(
  cookie: string | undefined,
): Promise<ApiResult<NotificationSettings>> {
  return apiRequest<NotificationSettings>(
    '/me/notification-settings',
    cookie === undefined ? {} : { cookie },
  );
}

/** Whether *this* viewer may post, and if not, why not. The half that needs the session. */
export function fetchPanelPermission(
  fixtureId: string,
  cookie: string | undefined,
): Promise<ApiResult<PanelPermission>> {
  return apiRequest<PanelPermission>(
    `/fixtures/${fixtureId}/panel/permission`,
    cookie === undefined ? {} : { cookie },
  );
}

export function fetchGroupInvites(
  cookie: string | undefined,
): Promise<ApiResult<GroupInvitesResponse>> {
  return apiRequest<GroupInvitesResponse>(
    '/me/group-invites',
    cookie === undefined ? {} : { cookie },
  );
}

/** The queue of people asking to join; only whoever runs the group may read it. */
export function fetchGroupRequests(
  slug: string,
  cookie: string | undefined,
): Promise<ApiResult<GroupJoinRequestsResponse>> {
  return apiRequest<GroupJoinRequestsResponse>(
    `/groups/${encodeURIComponent(slug)}/requests`,
    cookie === undefined ? {} : { cookie },
  );
}

/**
 * The group's board (T-243). The same endpoint shape as `/leaderboard` and the
 * same response, because it is the same board with the population narrowed:
 * 403 when the viewer is outside a group that shows its membership to members,
 * 404 when they may not know the group is there at all.
 */
export function fetchGroupLeaderboard(
  slug: string,
  cookie: string | undefined,
): Promise<ApiResult<LeaderboardResponse>> {
  return apiRequest<LeaderboardResponse>(
    `/groups/${encodeURIComponent(slug)}/leaderboard`,
    cookie === undefined ? {} : { cookie },
  );
}

/**
 * What a group called one fixture (T-246). 403 when the viewer is outside a
 * group that shows its membership to members, 404 when the group or the fixture
 * is not there.
 */
export function fetchGroupComparison(
  slug: string,
  fixtureId: string,
  cookie: string | undefined,
): Promise<ApiResult<GroupPredictionComparisonResponse>> {
  return apiRequest<GroupPredictionComparisonResponse>(
    `/groups/${encodeURIComponent(slug)}/fixtures/${encodeURIComponent(fixtureId)}/predictions`,
    cookie === undefined ? {} : { cookie },
  );
}

/** `GET /health/ingestion` (T-071): the feed's recent runs; null when unreachable. */
export async function fetchIngestionHealth(): Promise<IngestionHealth | null> {
  const result = await apiRequest<IngestionHealth>('/health/ingestion');
  return result.ok ? result.data : null;
}

/**
 * `GET /health/live` and `GET /health/chat` (T-071, T-233), for the operator's
 * page. `null` when the API cannot be reached, which the panel states rather
 * than rendering as zeros.
 */
export async function fetchLiveHealth(): Promise<LiveHealth | null> {
  const result = await apiRequest<LiveHealth>('/health/live');
  return result.ok ? result.data : null;
}

export async function fetchChatHealth(): Promise<ChatHealth | null> {
  const result = await apiRequest<ChatHealth>('/health/chat');
  return result.ok ? result.data : null;
}

export async function fetchApiHealth(): Promise<ApiHealth> {
  const result = await apiRequest<HealthReport>('/health');
  return result.ok ? { reachable: true, report: result.data } : { reachable: false };
}

/**
 * Every call to `apps/api` goes through here, server-side only (D-027). The
 * browser never talks to the API: the web app forwards the member's session
 * cookie on their behalf and mirrors the API's `Set-Cookie` onto its own
 * origin, so the cookie stays first-party.
 *
 * Failure is a value. `status` 0 means the API could not be reached at all.
 */
export type ApiResult<T> =
  | { ok: true; status: number; data: T; setCookie: string | null }
  | { ok: false; status: number; error: ApiError | null; setCookie: string | null };

export interface ApiRequestInit {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** The `Cookie` header to forward, e.g. from `sessionCookieHeader()`. */
  cookie?: string;
}

export async function apiRequest<T>(
  path: string,
  init: ApiRequestInit = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    // Tracing (T-071): the API echoes the id and puts it in every log line
    // about this call, so a page's failure can be found in the API's log.
    'x-request-id': `web-${crypto.randomUUID()}`,
  };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.cookie !== undefined) headers.cookie = init.cookie;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    });
  } catch {
    // The API being down is an expected state during development, not an
    // exception a page should crash on.
    return { ok: false, status: 0, error: null, setCookie: null };
  }

  const setCookie = response.headers.get('set-cookie');
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text === '' ? null : (JSON.parse(text) as unknown);
  } catch {
    json = null;
  }

  if (response.ok) {
    return { ok: true, status: response.status, data: json as T, setCookie };
  }

  const error =
    typeof json === 'object' && json !== null && 'error' in json ? (json as ApiError) : null;
  return { ok: false, status: response.status, error, setCookie };
}

// Typed readers for the pages. Each returns `null` where "not there" is a
// normal outcome the page renders, and lets everything else through as the
// result so the page can say "unreachable" rather than guess.

export async function fetchMe(cookie: string | undefined): Promise<SessionResponse['user'] | null> {
  if (cookie === undefined) return null;
  const result = await apiRequest<SessionResponse>('/auth/me', { cookie });
  return result.ok ? result.data.user : null;
}

export function fetchProfile(
  username: string,
  cookie: string | undefined,
): Promise<ApiResult<ProfileView>> {
  return apiRequest<ProfileView>(`/profiles/${encodeURIComponent(username)}`, { cookie });
}

export function fetchOwnProfile(cookie: string | undefined): Promise<ApiResult<OwnProfile>> {
  return apiRequest<OwnProfile>('/me/profile', { cookie });
}

export async function fetchCountries(): Promise<CountriesResponse['countries'] | null> {
  const result = await apiRequest<CountriesResponse>('/countries');
  return result.ok ? result.data.countries : null;
}

export async function fetchFollowing(cookie: string | undefined): Promise<FollowedEntity[] | null> {
  if (cookie === undefined) return null;
  const result = await apiRequest<FollowingResponse>('/me/following', { cookie });
  return result.ok ? result.data.items : null;
}

export async function fetchTeams(): Promise<TeamsResponse['teams'] | null> {
  const result = await apiRequest<TeamsResponse>('/teams');
  return result.ok ? result.data.teams : null;
}

export async function fetchCompetitions(): Promise<CompetitionsResponse['competitions'] | null> {
  const result = await apiRequest<CompetitionsResponse>('/competitions');
  return result.ok ? result.data.competitions : null;
}

/** `GET /news${query}` (T-143); the session (if any) is what makes `following` answerable. */
export function fetchNewsSection(
  query: string,
  locale: string | undefined,
  cookie: string | undefined,
): Promise<ApiResult<NewsSectionResponse>> {
  return apiRequest<NewsSectionResponse>(withLocale(`/news${query}`, locale), { cookie });
}

/**
 * `GET /admin/debates` (T-143): the editor's list. A success is also the only
 * way the web app knows the viewer is an editor -- the session carries no
 * roles -- so the news page asks this once to decide whether to draw the
 * editor's controls.
 */
export function fetchDebates(cookie: string | undefined): Promise<ApiResult<DebateListResponse>> {
  return apiRequest<DebateListResponse>('/admin/debates?state=open', { cookie });
}

/** `GET /scores?${query}`; the session (if any) pins favourites and enables the filter. */
export function fetchScores(
  query: string,
  cookie: string | undefined,
): Promise<ApiResult<ScoresResponse>> {
  return apiRequest<ScoresResponse>(`/scores?${query}`, cookie === undefined ? {} : { cookie });
}

/** `GET /search?${query}` (T-038): teams, competitions and people by name or alias. Public. */
export function fetchSearch(query: string): Promise<ApiResult<SearchResponse>> {
  return apiRequest<SearchResponse>(`/search?${query}`);
}

/**
 * `GET /players/:id?locale=` (T-037, T-303): the player page, with the name in
 * the reader's language beside the canonical one when somebody has written it.
 * Public.
 */
export function fetchPlayer(id: string, locale?: string): Promise<ApiResult<PlayerPage>> {
  return apiRequest<PlayerPage>(withLocale(`/players/${encodeURIComponent(id)}`, locale));
}

/** `GET /teams/:id?locale=` (T-036, T-303): the team page. Public. */
export function fetchTeam(id: string, locale?: string): Promise<ApiResult<TeamPage>> {
  return apiRequest<TeamPage>(withLocale(`/teams/${encodeURIComponent(id)}`, locale));
}

/** `GET /competitions/:id${query}&locale=` (T-035, T-303): the competition page for one season. Public. */
export function fetchCompetition(
  id: string,
  query: string,
  locale?: string,
): Promise<ApiResult<CompetitionPage>> {
  return apiRequest<CompetitionPage>(
    withLocale(`/competitions/${encodeURIComponent(id)}${query}`, locale),
  );
}

/** `GET /users/:username/predictions?${query}` (T-056): the history as this viewer may see it. */
export function fetchPredictionHistory(
  username: string,
  query: string,
  cookie: string | undefined,
): Promise<ApiResult<PredictionHistoryResponse>> {
  return apiRequest<PredictionHistoryResponse>(
    `/users/${encodeURIComponent(username)}/predictions?${query}`,
    cookie === undefined ? {} : { cookie },
  );
}

/** `GET /users/:username/rating` (T-053): the current rating, null before the first settlement. Public. */
export function fetchRating(username: string): Promise<ApiResult<RatingResponse>> {
  return apiRequest<RatingResponse>(`/users/${encodeURIComponent(username)}/rating`);
}

/** `GET /leaderboard?${query}` (T-055): ranked current ratings behind the minimum-sample filter. Public. */
export function fetchLeaderboard(query: string): Promise<ApiResult<LeaderboardResponse>> {
  return apiRequest<LeaderboardResponse>(`/leaderboard?${query}`);
}

/** `GET /fixtures/:id`: the match centre payload (T-033). Public. */
export function fetchMatchCentre(fixtureId: string): Promise<ApiResult<MatchCentre>> {
  return apiRequest<MatchCentre>(`/fixtures/${encodeURIComponent(fixtureId)}`);
}

/** `GET /fixtures/:id/forecasts` (T-064): every version, oldest first, with coverage. Public. */
export function fetchForecasts(fixtureId: string): Promise<ApiResult<ForecastVersionsResponse>> {
  return apiRequest<ForecastVersionsResponse>(
    `/fixtures/${encodeURIComponent(fixtureId)}/forecasts`,
  );
}

/** `GET /fixtures/:id/founder-analysis` (T-131): the analysis and its versions. Public. */
/**
 * Everything published on this match (T-262). **No cookie**: a published
 * analysis is meant to be read, so sending a session would make a public
 * document viewer-specific for nothing.
 */
export function fetchCommunityAnalyses(
  fixtureId: string,
): Promise<ApiResult<CommunityAnalysesResponse>> {
  return apiRequest<CommunityAnalysesResponse>(
    `/fixtures/${encodeURIComponent(fixtureId)}/community-analyses`,
  );
}

/** The analyst's own workspace for one match: draft, attempts, decisions, versions. */
export function fetchMyAnalysis(
  fixtureId: string,
  cookie: string | undefined,
): Promise<ApiResult<CommunityAnalysisWorkspace>> {
  return apiRequest<CommunityAnalysisWorkspace>(
    `/me/analyses/${encodeURIComponent(fixtureId)}`,
    cookie === undefined ? {} : { cookie },
  );
}

/** What is waiting to be read, oldest first. Needs the editor or admin role. */
export function fetchAnalysisQueue(
  cookie: string | undefined,
): Promise<
  ApiResult<{ submissions: CommunitySubmission[]; authors: string[]; generated_at: string }>
> {
  return apiRequest<{
    submissions: CommunitySubmission[];
    authors: string[];
    generated_at: string;
  }>('/admin/analysis-reviews', cookie === undefined ? {} : { cookie });
}

export function fetchFounderAnalysis(
  fixtureId: string,
): Promise<ApiResult<FounderAnalysisResponse>> {
  return apiRequest<FounderAnalysisResponse>(
    `/fixtures/${encodeURIComponent(fixtureId)}/founder-analysis`,
  );
}

/** `GET /founder-analyses` (T-132): the feed for the homepage, team and competition pages. */
export function fetchFounderFeed(
  query: { limit?: number; team?: string; competition?: string } = {},
): Promise<ApiResult<FounderAnalysesResponse>> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.team !== undefined) params.set('team', query.team);
  if (query.competition !== undefined) params.set('competition', query.competition);
  const suffix = params.toString();
  return apiRequest<FounderAnalysesResponse>(
    `/founder-analyses${suffix === '' ? '' : `?${suffix}`}`,
  );
}

/**
 * `GET /forecasts?fixtures=` and `GET /consensus?fixtures=` (T-136): each
 * product for a set of fixtures, one request each.
 *
 * Two calls rather than one combined endpoint, because they are two of the
 * three prediction products and nothing should make it easy to hand one where
 * the other was promised (rule 6).
 */
export function fetchForecastList(fixtureIds: string[]): Promise<ApiResult<ForecastListResponse>> {
  return apiRequest<ForecastListResponse>(`/forecasts?fixtures=${fixtureIds.join(',')}`);
}

export function fetchConsensusList(
  fixtureIds: string[],
): Promise<ApiResult<ConsensusListResponse>> {
  return apiRequest<ConsensusListResponse>(`/consensus?fixtures=${fixtureIds.join(',')}`);
}

/** `GET /fixtures/:id/power-index` (T-114): the latest index for both sides. Public. */
/**
 * `GET /fixtures/:id/consensus` (T-134): what the community predicted, as the
 * crowd distribution and the rating-weighted one. Public.
 */
export function fetchConsensus(fixtureId: string): Promise<ApiResult<CommunityConsensusResponse>> {
  return apiRequest<CommunityConsensusResponse>(
    `/fixtures/${encodeURIComponent(fixtureId)}/consensus`,
  );
}

export function fetchPowerIndex(fixtureId: string): Promise<ApiResult<PowerIndexResponse>> {
  return apiRequest<PowerIndexResponse>(`/fixtures/${encodeURIComponent(fixtureId)}/power-index`);
}

/** `GET /fixtures/:id/evaluations` (T-066): how each version did after the match. Public. */
export function fetchEvaluations(
  fixtureId: string,
): Promise<ApiResult<FixtureEvaluationsResponse>> {
  return apiRequest<FixtureEvaluationsResponse>(
    `/fixtures/${encodeURIComponent(fixtureId)}/evaluations`,
  );
}

/** `GET /fixtures/:id/prediction`: the member's own prediction, or null when there is none. */
export async function fetchOwnPrediction(
  fixtureId: string,
  cookie: string | undefined,
): Promise<PredictionResponse['prediction'] | null> {
  if (cookie === undefined) return null;
  const result = await apiRequest<PredictionResponse>(
    `/fixtures/${encodeURIComponent(fixtureId)}/prediction`,
    { cookie },
  );
  return result.ok ? result.data.prediction : null;
}

// The social graph (blueprint 8.1, T-202). Each of these needs the session: the
// answer is about the viewer's own relationships and there is no public form of
// one.

export function fetchFriends(cookie: string | undefined): Promise<ApiResult<FriendsResponse>> {
  return apiRequest<FriendsResponse>('/me/friends', { cookie });
}

export function fetchFriendRequests(
  cookie: string | undefined,
): Promise<ApiResult<FriendRequestsResponse>> {
  return apiRequest<FriendRequestsResponse>('/me/friend-requests', { cookie });
}

export function fetchBlocks(cookie: string | undefined): Promise<ApiResult<BlocksResponse>> {
  return apiRequest<BlocksResponse>('/me/blocks', { cookie });
}

/**
 * Where the viewer stands with one member, or `null` when nobody is signed in.
 *
 * A guest has no standing with anybody, and asking would be a 401 the profile
 * page would then have to explain away.
 */
export async function fetchFriendStatus(
  username: string,
  cookie: string | undefined,
): Promise<FriendStatusResponse['status'] | null> {
  if (cookie === undefined) return null;
  const result = await apiRequest<FriendStatusResponse>(
    `/me/friend-status/${encodeURIComponent(username)}`,
    { cookie },
  );
  return result.ok ? result.data.status : null;
}

// Conversations (blueprint 8.3, T-224). Every one of these needs the session:
// a conversation is only ever answered to a participant.

export function fetchConversations(
  cookie: string | undefined,
): Promise<ApiResult<ConversationsResponse>> {
  return apiRequest<ConversationsResponse>('/me/conversations', { cookie });
}

export function fetchConversation(
  id: string,
  query: string,
  cookie: string | undefined,
): Promise<ApiResult<ConversationPage>> {
  return apiRequest<ConversationPage>(
    `/me/conversations/${encodeURIComponent(id)}${query === '' ? '' : `?${query}`}`,
    { cookie },
  );
}

export function fetchConversationSearch(
  id: string,
  term: string,
  cookie: string | undefined,
): Promise<ApiResult<ConversationSearchResponse>> {
  return apiRequest<ConversationSearchResponse>(
    `/me/conversations/${encodeURIComponent(id)}/search?q=${encodeURIComponent(term)}`,
    { cookie },
  );
}
