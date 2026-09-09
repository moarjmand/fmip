/**
 * The provider-neutral shapes every adapter produces (rule 2 in CLAUDE.md:
 * nothing provider-specific crosses this boundary).
 *
 * Two conventions run through every type here:
 *
 *   - Entities are referenced by the **provider's** id, as a string, together
 *     with the human name the provider gave. The entity resolver in `apps/api`
 *     turns the id into our UUID; the name is what a reviewer sees when it
 *     cannot. Nothing here is keyed by name (rule 1).
 *   - A field the provider did not supply is `null`. Never `0`, never `''`,
 *     never a guess (rule 3). The contract check enforces the types; the
 *     adapter author is responsible for the honesty.
 */

export const PROVIDERS = ['api_football', 'football_data_org', 'highlightly'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const FIXTURE_STATUSES = [
  'scheduled',
  'live',
  'finished',
  'postponed',
  'suspended',
  'cancelled',
  'abandoned',
  'awarded',
] as const;
export type FixtureStatus = (typeof FIXTURE_STATUSES)[number];

export const STAGE_KINDS = ['league', 'group', 'knockout', 'playoff', 'qualifying'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const INCIDENT_KINDS = [
  'goal',
  'own_goal',
  'penalty_goal',
  'penalty_missed',
  'yellow_card',
  'second_yellow_card',
  'red_card',
  'substitution',
  'var',
] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward'] as const;
export type Position = (typeof POSITIONS)[number];

export const PERIOD_KINDS = [
  'first_half',
  'second_half',
  'extra_time_first',
  'extra_time_second',
  'penalties',
] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

/** The closed metric list from `fixture_stat` (T-011). */
export const STAT_METRICS = [
  'possession_pct',
  'shots',
  'shots_on_target',
  'shots_off_target',
  'blocked_shots',
  'corners',
  'offsides',
  'fouls',
  'yellow_cards',
  'red_cards',
  'passes',
  'passes_accurate',
  'pass_accuracy_pct',
  'saves',
  'expected_goals',
] as const;
export type StatMetric = (typeof STAT_METRICS)[number];

export type Side = 'home' | 'away';

/** A provider's id for an entity plus the name it gave. */
export interface EntityRef {
  externalId: string;
  name: string;
}

/** Like `EntityRef`, for entities a provider often names without identifying. */
export interface LooseEntityRef {
  externalId: string | null;
  name: string;
}

export interface Score {
  home: number;
  away: number;
}

export interface NormalisedFixture {
  externalId: string;
  competition: EntityRef;
  season: { label: string; startYear: number };
  stage: { name: string; kind: StageKind } | null;
  round: string | null;
  /** ISO 8601 with offset. */
  kickoffAt: string;
  status: FixtureStatus;
  /** Live display minute; `null` unless live. */
  minute: number | null;
  home: EntityRef;
  away: EntityRef;
  venue: (LooseEntityRef & { city: string | null }) | null;
  referee: LooseEntityRef | null;
  scores: {
    current: Score | null;
    halfTime: Score | null;
    fullTime: Score | null;
    extraTime: Score | null;
    penalties: Score | null;
    aggregate: Score | null;
  };
  /** When the provider says this record was last updated; the fetch time if it does not say. */
  lastUpdatedAt: string;
}

export interface NormalisedIncident {
  fixtureExternalId: string;
  /** Order within the fixture, from 1. The only ordering that survives two events in one minute. */
  sequence: number;
  minute: number;
  addedTime: number | null;
  kind: IncidentKind;
  /** The side credited; `null` for events that belong to neither (a VAR review). */
  side: Side | null;
  player: EntityRef | null;
  /** The assist provider, or the player coming on. */
  relatedPlayer: EntityRef | null;
  detail: string | null;
}

export interface NormalisedLineupPlayer extends EntityRef {
  role: 'starter' | 'bench';
  shirtNumber: number | null;
  position: Position | null;
  isCaptain: boolean;
}

export interface NormalisedSideLineup {
  formation: string | null;
  coach: EntityRef | null;
  players: NormalisedLineupPlayer[];
}

export interface NormalisedLineup {
  fixtureExternalId: string;
  home: NormalisedSideLineup;
  away: NormalisedSideLineup;
}

export interface NormalisedStandingRow {
  position: number;
  team: EntityRef;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  /** Recent results, oldest first, e.g. "WWDLW". `null` when not supplied. */
  form: string | null;
}

export interface NormalisedStanding {
  competition: EntityRef;
  seasonLabel: string;
  stage: string | null;
  group: string | null;
  rows: NormalisedStandingRow[];
  lastUpdatedAt: string;
}

export interface NormalisedPeriod {
  kind: PeriodKind;
  startedAt: string;
  endedAt: string | null;
  addedMinutes: number | null;
}

export interface NormalisedStat {
  side: Side;
  metric: StatMetric;
  value: number;
}

/** Everything a match centre needs after the whistle. */
export interface NormalisedFixtureDetail {
  fixture: NormalisedFixture;
  incidents: NormalisedIncident[];
  /** `null` when the provider does not supply lineups for this fixture. */
  lineup: NormalisedLineup | null;
  /** Absent metrics are absent, not zero. */
  statistics: NormalisedStat[];
  periods: NormalisedPeriod[];
}
