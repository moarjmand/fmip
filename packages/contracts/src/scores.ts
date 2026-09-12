/**
 * `GET /scores` (T-030): the scores list of blueprint 4.1. A date range in
 * the user's timezone, filters, matches grouped by country and competition,
 * favourites pinned above the standard list.
 *
 * Every card carries the coverage state of its season's scores module and
 * the time its data last changed (rules 3 and 4). Fields the platform does
 * not have yet (forecast summary, community totals, viewing availability) are
 * absent from the shape rather than present and empty; the page labels them.
 */

import type { CoverageState } from './coverage';

export type FixtureStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'postponed'
  | 'suspended'
  | 'cancelled'
  | 'abandoned'
  | 'awarded';

export interface ScoreLine {
  home: number;
  away: number;
}

/**
 * Freshness of a live fixture's data (rule 4, T-083, D-045). A match in
 * progress whose data has not changed for this long is `stale`: the feed
 * is behind, and the page must say so instead of showing the last minute as
 * the current one. Not applicable (`null`) before kick-off or after the end.
 */
export const STALE_LIVE_AFTER_MS = 120_000;
export type Freshness = 'current' | 'stale';

export interface ScoreCardTeam {
  id: string;
  name: string;
  short_name: string | null;
  code: string | null;
}

/** The incidents a list card shows: goals, red cards and VAR decisions. */
export type ScoreCardIncidentKind =
  | 'goal'
  | 'own_goal'
  | 'penalty_goal'
  | 'penalty_missed'
  | 'red_card'
  | 'second_yellow_card'
  | 'var';

export interface ScoreCardIncident {
  kind: ScoreCardIncidentKind;
  minute: number;
  added_time: number | null;
  /** The side credited; `null` for a VAR review that belongs to neither. */
  side: 'home' | 'away' | null;
  /** The player's display name, or `null` when the incident has no player. */
  player: string | null;
}

export interface ScoreCard {
  id: string;
  /** ISO 8601, UTC. The page renders it in the user's timezone. */
  kickoff_at: string;
  status: FixtureStatus;
  /** Live display minute; `null` unless live. */
  minute: number | null;
  competition: { id: string; name: string; short_name: string | null; country_id: string | null };
  season: { id: string; label: string };
  stage: { id: string; name: string; kind: string } | null;
  round: string | null;
  leg: 1 | 2 | null;
  home: ScoreCardTeam;
  away: ScoreCardTeam;
  scores: {
    current: ScoreLine | null;
    half_time: ScoreLine | null;
    full_time: ScoreLine | null;
    extra_time: ScoreLine | null;
    penalties: ScoreLine | null;
    aggregate: ScoreLine | null;
  };
  /** Players sent off so far, per side (red and second yellow). */
  red_cards: { home: number; away: number };
  /** Goals, red cards and VAR decisions in match order. */
  incidents: ScoreCardIncident[];
  venue: { id: string; name: string; city: string | null } | null;
  /** The season's scores-module coverage; `limited` when no profile is recorded. */
  coverage: CoverageState;
  /** When the fixture, its scores or its incidents last changed. */
  last_updated_at: string;
  /** `stale` when live and unchanged for `STALE_LIVE_AFTER_MS`; `null` when not live. */
  freshness: Freshness | null;
  /** Ranked above the standard list because of the viewer's favourites. */
  pinned: boolean;
}

export interface ScoresGroup {
  /** `null` for continental and international competitions. */
  country: { id: string; name: string; code: string } | null;
  competition: { id: string; name: string; short_name: string | null };
  /** Kick-off order. */
  fixtures: ScoreCard[];
}

export type ScoresAgeFilter = 'senior' | 'youth';

/** The query as the API understood it, echoed so the page can show it. */
export interface ScoresFilters {
  /** Inclusive ISO dates, interpreted in `timezone`. */
  from: string;
  to: string;
  /** IANA name, e.g. `Asia/Tehran`. */
  timezone: string;
  live: boolean;
  /** Only fixtures involving something the viewer follows. Needs a session. */
  favourites: boolean;
  country_id: string | null;
  competition_id: string | null;
  stage_id: string | null;
  gender: 'men' | 'women' | null;
  age: ScoresAgeFilter | null;
}

export interface ScoresResponse {
  filters: ScoresFilters;
  generated_at: string;
  /** Cards in `pinned` plus cards in every group. */
  total: number;
  /** Favourite teams and competitions first; empty for a guest. */
  pinned: ScoreCard[];
  /** Grouped by competition, ordered by the viewer's follows, then country, then name. */
  groups: ScoresGroup[];
}
