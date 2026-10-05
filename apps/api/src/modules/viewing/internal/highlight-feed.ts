import type { NormalisedHighlight } from '@fmip/ingestion';

/**
 * The highlights feed's rules (T-1366, D-184), pure: whether the feed is on,
 * where a clip may be offered, and which of our matches a clip belongs to.
 * The service runs them; the store keeps what they decide.
 */

/** The feed's own daily request ceiling, when `HIGHLIGHTS_DAILY_BUDGET` is empty. */
export const HIGHLIGHTS_DEFAULT_BUDGET = 5000;
/** A finished match is asked about until this long after kick-off: verified clips arrive 1-48 h after the whistle. */
export const FEED_WINDOW_HOURS = 51;
/** How far apart the feed's kick-off and ours may be and still be the same match. */
export const KICKOFF_TOLERANCE_MS = 3 * 60 * 60 * 1000;
/** Geo questions per match per run: a clip whose territories are unknown is passed over for the next. */
export const GEO_TRIES_PER_MATCH = 3;

export type FeedConfig =
  { state: 'absent' } | { state: 'configured'; apiKey: string; dailyBudget: number };

/**
 * On exactly when `HIGHLIGHTLY_KEY` holds a key: empty is the honest absence
 * the health endpoint reports, with no queue, no request and no row. A
 * ceiling that is not a positive whole number stops the API at boot rather
 * than being guessed at (D-049's rule for budgets).
 */
export function feedConfig(env: NodeJS.ProcessEnv): FeedConfig {
  const apiKey = (env.HIGHLIGHTLY_KEY ?? '').trim();
  if (apiKey === '') return { state: 'absent' };
  const raw = (env.HIGHLIGHTS_DAILY_BUDGET ?? '').trim();
  if (raw === '') return { state: 'configured', apiKey, dailyBudget: HIGHLIGHTS_DEFAULT_BUDGET };
  const dailyBudget = Number(raw);
  if (!Number.isInteger(dailyBudget) || dailyBudget <= 0) {
    throw new Error(`HIGHLIGHTS_DAILY_BUDGET must be a positive whole number, not "${raw}"`);
  }
  return { state: 'configured', apiKey, dailyBudget };
}

/** A clip's territory rule as stored: an empty allow list allows every territory. */
export interface TerritoryRule {
  allowed: readonly string[];
  blocked: readonly string[];
}

/** The one copy of the rule: offered where allowed (or allowed everywhere) and not blocked. */
export function offeredIn(rule: TerritoryRule, territory: string): boolean {
  const code = territory.toUpperCase();
  if (rule.blocked.includes(code)) return false;
  return rule.allowed.length === 0 || rule.allowed.includes(code);
}

/** A finished match inside the window. */
export interface FeedCandidate {
  fixtureId: string;
  /** True when the feed already holds a clip for it (or an editor withdrew one): matched, never stored again. */
  held: boolean;
  kickoffAt: Date;
  competitionId: string;
  /** The competition's id at the feed, from `provider_mapping`; null when nobody mapped it. */
  leagueExternalId: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
}

/** One question to the feed: a league on a UTC day, and our matches it should answer for. */
export interface FeedQuestion {
  leagueExternalId: string;
  competitionId: string;
  date: string;
  candidates: FeedCandidate[];
}

/**
 * The questions a run asks -- one per league and day with a match still
 * waiting; the day's held matches ride along so their clips are recognised
 * rather than reported as matching nothing -- and the competitions of
 * waiting matches it cannot ask about because nobody mapped them.
 */
export function feedQuestions(candidates: FeedCandidate[]): {
  questions: FeedQuestion[];
  unmappedCompetitions: Set<string>;
} {
  const byKey = new Map<string, FeedQuestion>();
  const unmappedCompetitions = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.leagueExternalId === null) {
      if (!candidate.held) unmappedCompetitions.add(candidate.competitionId);
      continue;
    }
    const date = candidate.kickoffAt.toISOString().slice(0, 10);
    const key = `${candidate.leagueExternalId}/${date}`;
    const question = byKey.get(key) ?? {
      leagueExternalId: candidate.leagueExternalId,
      competitionId: candidate.competitionId,
      date,
      candidates: [],
    };
    question.candidates.push(candidate);
    byKey.set(key, question);
  }
  const questions = [...byKey.values()].filter((q) => q.candidates.some((c) => !c.held));
  return { questions, unmappedCompetitions };
}

export type UnmatchedReason = 'team_unmapped' | 'no_fixture' | 'ambiguous';

export interface Unmatched {
  reason: UnmatchedReason;
  clip: NormalisedHighlight;
}

/**
 * Which of our matches each clip belongs to (rule 1: never by a name). Both
 * of the clip's teams must be mapped to ours through `provider_mapping`
 * (`teams`: the feed's team id -> our team id, or null when unmapped), and
 * exactly one candidate must have that pair -- in either order, since a
 * neutral ground is named differently by different sources -- with a
 * kick-off within `KICKOFF_TOLERANCE_MS`. Anything else is kept out with its
 * reason. Each match's clips come back best first: full-match highlights
 * before a clip that named no category, otherwise in the feed's order.
 */
export function matchClips(
  clips: NormalisedHighlight[],
  candidates: FeedCandidate[],
  teams: ReadonlyMap<string, string | null>,
): { matched: Map<string, NormalisedHighlight[]>; unmatched: Unmatched[] } {
  const matched = new Map<string, NormalisedHighlight[]>();
  const unmatched: Unmatched[] = [];
  for (const clip of clips) {
    const home = teams.get(clip.match.home.externalId) ?? null;
    const away = teams.get(clip.match.away.externalId) ?? null;
    if (home === null || away === null) {
      unmatched.push({ reason: 'team_unmapped', clip });
      continue;
    }
    const kickoff = Date.parse(clip.match.kickoffAt);
    const fits = candidates.filter((candidate) => {
      const pair =
        (candidate.homeTeamId === home && candidate.awayTeamId === away) ||
        (candidate.homeTeamId === away && candidate.awayTeamId === home);
      return pair && Math.abs(candidate.kickoffAt.getTime() - kickoff) <= KICKOFF_TOLERANCE_MS;
    });
    if (fits.length !== 1) {
      unmatched.push({ reason: fits.length === 0 ? 'no_fixture' : 'ambiguous', clip });
      continue;
    }
    const list = matched.get(fits[0]!.fixtureId) ?? [];
    list.push(clip);
    matched.set(fits[0]!.fixtureId, list);
  }
  for (const list of matched.values()) {
    list.sort((a, b) => Number(b.matchHighlights) - Number(a.matchHighlights));
  }
  return { matched, unmatched };
}
