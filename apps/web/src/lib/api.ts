import type {
  ApiError,
  CompetitionPage,
  CompetitionsResponse,
  CountriesResponse,
  FixtureEvaluationsResponse,
  FollowedEntity,
  ForecastVersionsResponse,
  FollowingResponse,
  HealthReport,
  LeaderboardResponse,
  MatchCentre,
  OwnProfile,
  PlayerPage,
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

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';

/**
 * The API's own reachability, as seen from the web app.
 *
 * `unreachable` is a state, not an error to swallow: rule 3 says a missing
 * answer is labelled, never faked. The caller renders the difference.
 */
export type ApiHealth = { reachable: true; report: HealthReport } | { reachable: false };

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

/** `GET /players/:id` (T-037): the player page. Public. */
export function fetchPlayer(id: string): Promise<ApiResult<PlayerPage>> {
  return apiRequest<PlayerPage>(`/players/${encodeURIComponent(id)}`);
}

/** `GET /teams/:id` (T-036): the team page. Public. */
export function fetchTeam(id: string): Promise<ApiResult<TeamPage>> {
  return apiRequest<TeamPage>(`/teams/${encodeURIComponent(id)}`);
}

/** `GET /competitions/:id${query}` (T-035): the competition page for one season. Public. */
export function fetchCompetition(id: string, query: string): Promise<ApiResult<CompetitionPage>> {
  return apiRequest<CompetitionPage>(`/competitions/${encodeURIComponent(id)}${query}`);
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
