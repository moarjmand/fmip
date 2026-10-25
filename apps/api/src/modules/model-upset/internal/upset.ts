import type {
  ForecastKind,
  MatchOutcome,
  ModelProbabilities,
  ModelUpsetResponse,
} from '@fmip/contracts';
import { dateIn, isTimeZone } from '../../fixtures/fixtures.service';

/**
 * The pure half of the model's biggest miss of a day (T-1507, D-265): which
 * day is asked, and how the store's one row becomes the answer. The choice
 * of the match itself is the store's query.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface UpsetDay {
  date: string;
  timeZone: string;
}

export type ParsedUpsetQuery =
  { ok: true; day: UpsetDay } | { ok: false; fields: Record<string, string> };

function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Fastify hands a repeated parameter over as an array; the first one counts. */
function first(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/**
 * `?date=YYYY-MM-DD&tz=Area/City`, both optional, read as `GET /scores`
 * reads them: the zone defaults to UTC and the date to today in that zone,
 * so the card's day is the day the reader's scores list calls today.
 */
export function parseUpsetQuery(raw: Record<string, unknown>, now: Date): ParsedUpsetQuery {
  const fields: Record<string, string> = {};
  const timeZone = first(raw.tz) ?? 'UTC';
  if (!isTimeZone(timeZone)) fields.tz = 'must be an IANA time zone, e.g. Europe/London';
  const date = first(raw.date) ?? dateIn(fields.tz === undefined ? timeZone : 'UTC', now);
  if (!isDate(date)) fields.date = 'must be a date, YYYY-MM-DD';
  return Object.keys(fields).length > 0
    ? { ok: false, fields }
    : { ok: true, day: { date, timeZone } };
}

/** What the store reads for a day: the counts, and the least likely result if any. */
export interface UpsetDayRow {
  finishedMatches: number;
  stillToPlay: number;
  lastUpdatedAt: Date | null;
  upset: UpsetRow | null;
}

export interface UpsetRow {
  fixtureId: string;
  kickoffAt: Date;
  seasonId: string;
  competition: { id: string; name: string; shortName: string | null };
  home: { id: string; name: string; shortName: string | null };
  away: { id: string; name: string; shortName: string | null };
  score: { home: number; away: number };
  probabilities: ModelProbabilities;
  versionNumber: number;
  kind: ForecastKind;
  modelVersion: string;
  computedAt: Date;
}

/** The result a full-time score is, as the evaluation reads it (T-066). */
export function outcomeOfScore(home: number, away: number): MatchOutcome {
  return home > away ? 'home' : home < away ? 'away' : 'draw';
}

const entity = (e: { id: string; name: string; shortName: string | null }) => ({
  id: e.id,
  name: e.name,
  short_name: e.shortName,
});

/** The answer for a day: the match, or `not_supplied` with why (rule 3). */
export function upsetResponse(day: UpsetDay, row: UpsetDayRow): ModelUpsetResponse {
  const base = {
    date: day.date,
    time_zone: day.timeZone,
    finished_matches: row.finishedMatches,
    still_to_play: row.stillToPlay,
    last_updated_at: row.lastUpdatedAt?.toISOString() ?? null,
  };
  const upset = row.upset;
  if (upset === null) {
    return {
      ...base,
      coverage: 'not_supplied',
      reason: row.finishedMatches === 0 ? 'no_finished_match' : 'no_covered_forecast',
      upset: null,
    };
  }
  const outcome = outcomeOfScore(upset.score.home, upset.score.away);
  return {
    ...base,
    coverage: 'available',
    reason: null,
    upset: {
      fixture_id: upset.fixtureId,
      kickoff_at: upset.kickoffAt.toISOString(),
      competition: entity(upset.competition),
      season_id: upset.seasonId,
      home_team: entity(upset.home),
      away_team: entity(upset.away),
      score: upset.score,
      outcome,
      probability: upset.probabilities[outcome],
      probabilities: upset.probabilities,
      forecast: {
        version_number: upset.versionNumber,
        kind: upset.kind,
        model_version: upset.modelVersion,
        computed_at: upset.computedAt.toISOString(),
      },
    },
  };
}
