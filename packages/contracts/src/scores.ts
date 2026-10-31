/**
 * `GET /scores` (T-030): the scores list of blueprint 4.1. A date range in
 * the user's timezone, filters, matches grouped by country and competition,
 * favourites pinned above the standard list.
 *
 * Every card carries the coverage state of its season's scores module and
 * the time its data last changed (rules 3 and 4).
 *
 * The model's forecast summary, the community totals and the viewing
 * indicator (T-940, D-114) are deliberately not on this shape. Each is its own
 * product with its own batch route (`GET /forecasts/pre-kickoff`,
 * `GET /consensus`, `GET /viewing`), which the page asks once per page, and
 * the stream stays scores only. One payload holding two prediction products is
 * what rule 6 forbids.
 */

import type { CoverageState } from './coverage';
import type { EntityMedia } from './media';

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
 * Whether a match not yet finished is still on the calendar (T-1560): it is
 * to be played, or is being played. A cancelled, abandoned or awarded match
 * will not be played, and a postponed one has lost its date, so none of them
 * is anyone's "next match" or "coming up". They stay in a fixture list, each
 * with its status said.
 */
export function stillToPlay(status: FixtureStatus | string): boolean {
  return status === 'scheduled' || status === 'live' || status === 'suspended';
}

/**
 * Freshness of a live fixture's data (rule 4, T-083, D-045). A match in
 * progress whose data has not changed for this long is `stale`: the feed
 * is behind, and the page must say so instead of showing the last minute as
 * the current one. Not applicable (`null`) before kick-off or after the end.
 */
export const STALE_LIVE_AFTER_MS = 120_000;
export type Freshness = 'current' | 'stale';

/**
 * The minutes at which a match's stored clock stands still while the match
 * goes on (T-1394, D-209): the feed counts added time apart from the minute,
 * so the minute stays at 45 through first-half added time and the half-time
 * interval, at 90 through second-half added time and the break before extra
 * time, at 105 through the extra-time interval and at 120 through the
 * shoot-out.
 */
export const STOPPED_CLOCK_MINUTES: readonly number[] = [45, 90, 105, 120];

/**
 * The moment a live match's freshness is measured from (T-1394, D-209), in
 * ms since the epoch. Normally its last change (`last_updated_at`): in play
 * the minute moves, so a row unchanged for `STALE_LIVE_AFTER_MS` is a feed
 * that stopped. Where no clock moves the row -- the stored minute at one of
 * `STOPPED_CLOCK_MINUTES`, or the match suspended -- an unchanged row is
 * expected, so the time the provider's live list last answered with the
 * match in it (`live_answered_at`) counts too: half-time is not "behind"
 * while the provider is still answering, and is the moment it stops.
 */
export function liveFreshnessFrom(fixture: {
  status: FixtureStatus;
  minute?: number | null;
  last_updated_at: string;
  live_answered_at?: string | null;
}): number {
  const changed = Date.parse(fixture.last_updated_at);
  const stopped =
    fixture.status === 'suspended' ||
    (fixture.status === 'live' &&
      fixture.minute != null &&
      STOPPED_CLOCK_MINUTES.includes(fixture.minute));
  if (!stopped || fixture.live_answered_at == null) return changed;
  const answered = Date.parse(fixture.live_answered_at);
  return Number.isNaN(answered) ? changed : Math.max(changed, answered);
}

/**
 * With `?locale=` (T-1312), on this and on every answer that names a team, a
 * competition or a country as `{ id, name }`: `name` is the reader's where
 * one is written (the canonical name where none is), and an English
 * `short_name` is `null` beside a localised name.
 */
export interface ScoreCardTeam {
  id: string;
  name: string;
  short_name: string | null;
  code: string | null;
  /** The team's crest from our own origin (T-1320); absent where a builder does not attach media. */
  crest?: EntityMedia;
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
  /** A kick of a penalty shoot-out (T-1673, D-322), as on `MatchIncident`. */
  in_shootout?: boolean;
}

export interface ScoreCard {
  id: string;
  /** ISO 8601, UTC. The page renders it in the user's timezone. */
  kickoff_at: string;
  status: FixtureStatus;
  /** Live display minute; `null` unless live. */
  minute: number | null;
  competition: {
    id: string;
    name: string;
    short_name: string | null;
    country_id: string | null;
    /** The competition's logo from our own origin (T-1320). */
    logo?: EntityMedia;
  };
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
  /**
   * When the provider's live list last answered while this match was live
   * or suspended, changed or not (T-1394, D-209); null otherwise, or when no
   * answer is recorded. `liveFreshnessFrom` reads it where no clock moves.
   */
  live_answered_at?: string | null;
  /** `stale` when live and unchanged for `STALE_LIVE_AFTER_MS` (see `liveFreshnessFrom`); `null` when not live. */
  freshness: Freshness | null;
  /** Ranked above the standard list because of the viewer's favourites. */
  pinned: boolean;
}

export interface ScoresGroup {
  /** `null` for continental and international competitions. */
  country: { id: string; name: string; code: string } | null;
  competition: {
    id: string;
    name: string;
    short_name: string | null;
    /** The competition's logo from our own origin, as its cards carry it (T-1321). */
    logo?: EntityMedia;
  };
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
