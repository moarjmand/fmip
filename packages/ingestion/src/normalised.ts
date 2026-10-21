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

/**
 * What an incident adds to its kind, in our words (T-1378, D-196): what a VAR
 * review decided. A provider detail that only repeats the kind ("Normal Goal",
 * "Yellow Card", "Substitution 1") is no detail, and one we cannot name is
 * none; the provider's own text never leaves the adapter (rule 2). Mapped by
 * `incidentDetail` (`adapters/incident-detail.ts`).
 */
export const INCIDENT_DETAILS = [
  'goal_cancelled',
  'goal_confirmed',
  'penalty_awarded',
  'penalty_cancelled',
  'penalty_confirmed',
  'card_upgraded',
  'card_cancelled',
] as const;
export type IncidentDetail = (typeof INCIDENT_DETAILS)[number];

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

/**
 * One player's numbers in one match (T-101), a closed list like the team's.
 * Counts are what the player did; `rating` is the provider's own 0-10 mark and
 * says so in its name nowhere else, so it is never averaged with anyone's.
 * There is no per-player expected goals here: the one source of it is
 * Highlightly's box score (T-1432, D-224), its own contract
 * (`adapters/highlightly/box-score.ts`) and its own table, labelled with its
 * source wherever it is shown, never a column of this list.
 */
export const PLAYER_STAT_METRICS = [
  'minutes',
  'rating',
  'shots',
  'shots_on_target',
  'goals',
  'assists',
  'key_passes',
  'passes',
  'tackles',
  'blocks',
  'interceptions',
  'duels',
  'duels_won',
  'dribbles',
  'dribbles_won',
  'fouls_drawn',
  'fouls_committed',
  'offsides',
  'yellow_cards',
  'red_cards',
  'saves',
  'goals_conceded',
] as const;
export type PlayerStatMetric = (typeof PLAYER_STAT_METRICS)[number];

export type Side = 'home' | 'away';

/** A provider's id for an entity plus the name it gave. */
export interface EntityRef {
  externalId: string;
  name: string;
  /**
   * The provider's address for the entity's image (a team's crest, a
   * competition's logo, a person's photo), when the answer carried one (T-1320,
   * D-176). An `https://` URL on the provider's side: the ingestion writers
   * hand it to the media store, which copies the file to our own volume. It
   * never reaches a contract or a page (rule 2). Absent when not carried.
   */
  imageUrl?: string;
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

/**
 * One entry of a provider's live list (T-830): the fixture, and what the same
 * answer carried beside it when it carries more. API-Football's live list
 * includes each match's events and says when the match is at the half-time
 * interval, so the minute-by-minute job learns a scorer or a red card without
 * spending a detail request; a provider whose live list is the fixture alone
 * leaves both absent, which is "not said", never "none".
 */
export interface NormalisedLiveFixture extends NormalisedFixture {
  /** Every incident so far, in provider order; absent when the live list does not carry them. */
  incidents?: NormalisedIncident[];
  /** True during the half-time interval; absent when the provider does not say. */
  halfTimeBreak?: boolean;
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
  /** What it adds to its kind, in our words; never the provider's text (T-1378). */
  detail: IncidentDetail | null;
}

/**
 * Where a starter stood in the side's shape (T-1397, D-212), in our terms:
 * `row` counts the lines from the goalkeeper's (1) towards the halfway line,
 * `col` counts across a line from the side's own left as it attacks (1).
 * Both are whole numbers from 1 to 11 (a side has eleven starters).
 */
export interface LineupGrid {
  row: number;
  col: number;
}

export interface NormalisedLineupPlayer extends EntityRef {
  role: 'starter' | 'bench';
  shirtNumber: number | null;
  position: Position | null;
  isCaptain: boolean;
  /**
   * The starter's place in the shape; null for the bench, for a provider that
   * does not supply it, and for a value that does not read as one (rule 3).
   */
  grid: LineupGrid | null;
}

export interface NormalisedSideLineup {
  formation: string | null;
  coach: EntityRef | null;
  players: NormalisedLineupPlayer[];
  /**
   * The colour of the side's outfield shirt in this match, `#rrggbb` in lower
   * case (T-1415, D-218). Null when the provider does not supply one or the
   * value is not a colour (rule 3); never a goalkeeper's shirt.
   */
  kitColour: string | null;
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
  /**
   * The stage the table belongs to, by the name our stages carry ("Apertura",
   * "League A"; T-1399). Null when the provider names none: the table is then
   * compared across the season's stages.
   */
  stage: string | null;
  /**
   * The group's own name inside a group stage, as `fixture.group_name` holds
   * it: "A", "1" (T-1333, `adapters/_group.ts`). Null for a table that is not
   * a group: a league's one table, a conference, a split.
   */
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

/**
 * Whether a player will miss a match (T-103). `out` is the provider's "will
 * miss it"; `doubtful` its "might". There is no third value for "fit": a
 * player nobody lists is simply not in the list.
 */
export const ABSENCE_STATUSES = ['out', 'doubtful'] as const;
export type AbsenceStatus = (typeof ABSENCE_STATUSES)[number];

/**
 * What the reason amounts to, read from the provider's own words, which are
 * kept beside it. `other` is a reason that is none of these (a coach's
 * decision, international duty); `null` is a reason that says nothing.
 */
export const ABSENCE_KINDS = ['injury', 'suspension', 'illness', 'other'] as const;
export type AbsenceKind = (typeof ABSENCE_KINDS)[number];

/** One player the provider says will miss, or may miss, one match. */
export interface NormalisedAbsence {
  fixtureExternalId: string;
  /** The player's club, by the provider's id: the answer does not say home or away. */
  team: EntityRef;
  player: EntityRef;
  status: AbsenceStatus;
  kind: AbsenceKind | null;
  /** The provider's words, e.g. "Knee Injury"; `null` when it gave none. */
  reason: string | null;
}

/**
 * What the provider says it covers for one competition's season (T-1364).
 * `absences` is whether it reports who will miss a match; `null` when its
 * answer does not say, which is not the same as no.
 */
export interface NormalisedSeasonCoverage {
  absences: boolean | null;
}

/**
 * A person's name in full, from the provider's player profile (T-1398,
 * D-213). `givenName` and `familyName` are every given name and every family
 * name the provider records ("Mohamed", "Salah Hamed Mahrous Ghaly"), and
 * `fullName` is the two together: the legal name, which is often longer than
 * the name a reader knows. Never an empty string, and entity-decoded.
 */
export interface NormalisedPersonName {
  fullName: string;
  givenName: string;
  familyName: string;
}

/**
 * A player's totals for one season with one team in one competition, as the
 * provider counts them (T-1431, D-223) -- every competition it covers,
 * including cups and national-team matches we do not ingest match by match.
 * A count the provider left out is `null`, never zero.
 */
export interface NormalisedPlayerSeasonLine {
  competition: EntityRef;
  team: EntityRef;
  /** The year the season starts in (2026 for "2026/27" and for "2026"). */
  seasonYear: number;
  appearances: number | null;
  starts: number | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  yellowCards: number | null;
  /** Sent off for a second yellow card. */
  secondYellowCards: number | null;
  /** Sent off with a straight red card. */
  redCards: number | null;
  /** A goalkeeper's; `null` for everyone else. */
  saves: number | null;
  /** A goalkeeper's; `null` for everyone else. */
  goalsConceded: number | null;
  /** The provider's average match rating, 0 to 10. */
  rating: number | null;
}

/** One club or national team in a player's career and the seasons they were there (T-1431). */
export interface NormalisedCareerEntry {
  team: EntityRef;
  /** The years those seasons start in, newest first, each once. */
  seasonYears: number[];
}

export const PREFERRED_FEET = ['left', 'right', 'both'] as const;
export type PreferredFoot = (typeof PREFERRED_FEET)[number];

/**
 * A nationality as the provider wrote it (T-1428, D-220): `name` plain and
 * entity-decoded, and `code` the FIFA trigram when the adapter knows that
 * spelling stands for one (a reviewed list, never a guess); `null` otherwise,
 * and the store then matches `name` to a country exactly or not at all.
 */
export interface NormalisedNationality {
  name: string;
  code: string | null;
}

/**
 * What a profile says about the person beyond the name (T-1428, D-220). Each
 * field is `null` when the provider did not say, or said something we cannot
 * read: an absent value, never a made-up one (rule 3).
 */
export interface NormalisedPersonBio {
  /** ISO 8601 calendar date. */
  dateOfBirth: string | null;
  nationality: NormalisedNationality | null;
  /** Whole centimetres, 100 to 250. */
  heightCm: number | null;
  preferredFoot: PreferredFoot | null;
}

/**
 * The provider's player profile (T-1398, T-1428). `shortName` is the name
 * the line-ups print ("M. Salah"), `name` the full name or `null` when either
 * half is blank, and `bio` the rest.
 */
export interface NormalisedPersonProfile {
  externalId: string;
  shortName: string | null;
  name: NormalisedPersonName | null;
  bio: NormalisedPersonBio;
}

/**
 * A player in a club's current squad listing (T-1324, T-1428): the ref and
 * photo, and the shirt number (1 to 99) and position the listing gives, each
 * `null` when it gives none.
 */
export interface NormalisedSquadPlayer extends EntityRef {
  shirtNumber: number | null;
  position: Position | null;
}

/** A count at home and away; one the provider left out is `null`, never zero. */
export interface HomeAway {
  home: number | null;
  away: number | null;
}

/** Goals in one band of minutes, as the provider counts them ("0-15", ..., "106-120"). */
export interface MinuteBand {
  /** The band's first and last minute: 0 and 15 for "0-15". */
  from: number;
  to: number;
  goals: number;
}

/** A biggest win or defeat at home or away, from the team's side: its goals first. */
export interface TeamScore {
  for: number;
  against: number;
}

/**
 * A team's statistics for one season of one competition, as the provider
 * counts them (T-1437, D-228). A count the provider left out is `null`, never
 * zero. The minute bands and the penalties are `null` when the provider's
 * bands do not add up to its own goal totals: in a cup it counts the kicks of
 * a penalty shoot-out in both, and a shoot-out kick is not a goal.
 */
export interface NormalisedTeamSeasonStats {
  competition: EntityRef;
  team: EntityRef;
  /** The year the season starts in. */
  seasonYear: number;
  played: HomeAway;
  wins: HomeAway;
  draws: HomeAway;
  losses: HomeAway;
  goalsFor: HomeAway;
  goalsAgainst: HomeAway;
  cleanSheets: HomeAway;
  failedToScore: HomeAway;
  /** Oldest result first, newest last: "W", "D" or "L" each. */
  form: string | null;
  goalsForByMinute: MinuteBand[] | null;
  goalsAgainstByMinute: MinuteBand[] | null;
  /** Whether the bands and the penalties were left out because the bands miss the goal totals. */
  bandsWithheld: boolean;
  penaltiesScored: number | null;
  penaltiesMissed: number | null;
  biggestWin: { home: TeamScore | null; away: TeamScore | null };
  biggestDefeat: { home: TeamScore | null; away: TeamScore | null };
  /** The longest runs of wins, draws and defeats. */
  longestRun: { wins: number | null; draws: number | null; losses: number | null };
  /** Each formation the team started in and how often, most used first. */
  formations: { formation: string; played: number }[];
}

/** What a pitch is laid with (T-1438, D-229); a provider's other words are `null`. */
export const VENUE_SURFACES = ['grass', 'artificial', 'hybrid'] as const;
export type VenueSurface = (typeof VENUE_SURFACES)[number];

/**
 * A ground as the provider describes it (T-1438, D-229): the name and city,
 * the street address, the capacity (a whole number above zero), the surface,
 * and the provider's https address for a picture of it (`imageUrl`, inside
 * ingestion only, like `EntityRef.imageUrl`). Each is `null` when unsaid or
 * unreadable. No coordinates: the provider sends none.
 */
export interface NormalisedVenueFacts {
  externalId: string;
  name: string;
  city: string | null;
  address: string | null;
  capacity: number | null;
  surface: VenueSurface | null;
  imageUrl: string | null;
}

/**
 * One team of a competition's season as the provider lists it (T-1438):
 * whether it is a national team, the year it was founded (1800 to 2100) and
 * its home ground, each `null` when unsaid.
 */
export interface NormalisedTeamFacts {
  team: EntityRef;
  national: boolean | null;
  foundedYear: number | null;
  venue: NormalisedVenueFacts | null;
}

export interface NormalisedPlayerStat {
  side: Side;
  player: EntityRef;
  metric: PlayerStatMetric;
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
  /**
   * Per player, per metric (T-101). `null` when the provider does not supply
   * player statistics at all; an empty list when it does and sent none for
   * this match. A metric a player has no value for is absent, never zero.
   */
  playerStatistics: NormalisedPlayerStat[] | null;
  periods: NormalisedPeriod[];
}

/**
 * One item from a publisher's feed, and only what the feed carries for that
 * purpose (T-142, D-061): the headline, the publisher's own summary, the
 * byline, the time, and the link to the original. There is no body field,
 * and that is the rights model in the type rather than in a check -- a reader
 * cannot return what a free source does not grant.
 */
export interface NormalisedNewsItem {
  /** The feed's own identity for the item (guid or id), or the link when it has none. */
  externalId: string;
  /** The original, where a reader is sent. */
  url: string;
  headline: string;
  /** The publisher's summary as they put it in the feed, tags stripped; `null` when absent. */
  summary: string | null;
  byline: string | null;
  /** ISO 8601; `null` when the feed gave no time, never "now". */
  publishedAt: string | null;
  /** BCP 47 when the feed or the item says; `null` otherwise. Never guessed. */
  language: string | null;
  /**
   * The publisher's own category strings on the item, as carried (T-1002,
   * D-123): RSS `<category>` text, Atom `<category term>`, in feed order,
   * duplicates removed, nothing else changed. Empty when the item carries none.
   */
  categories: string[];
  /**
   * The item's photo as the feed carried it (T-1322, D-177): RSS
   * `<enclosure type="image/*">`, `media:content`, `media:thumbnail`, or an
   * Atom enclosure link. `null` unless the reader was asked for images, which
   * the job does only for a source whose licence covers them. Where the
   * publisher keeps the file -- never shown to a reader, never in a contract.
   */
  imageUrl: string | null;
}
