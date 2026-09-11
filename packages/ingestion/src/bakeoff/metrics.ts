/**
 * The bake-off's measurements (05-data-providers.md, "The bake-off protocol").
 * Pure functions over normalised shapes, so the same numbers come out of a
 * live run and of a replay of the recordings.
 *
 * Field completeness is "of the fields a provider could have filled, how many
 * did it fill", per module. The lists below are the optional fields of each
 * normalised shape; required fields do not count because an adapter cannot
 * return the shape without them.
 */

import type {
  NormalisedFixture,
  NormalisedFixtureDetail,
  NormalisedLineup,
  NormalisedStanding,
} from '../normalised';
import { STAT_METRICS } from '../normalised';

export interface Completeness {
  filled: number;
  total: number;
}

export const EMPTY: Completeness = { filled: 0, total: 0 };

export function add(a: Completeness, b: Completeness): Completeness {
  return { filled: a.filled + b.filled, total: a.total + b.total };
}

/** Whole percent, or null when nothing could be counted. */
export function percent(c: Completeness): number | null {
  return c.total === 0 ? null : Math.round((100 * c.filled) / c.total);
}

function count(flags: boolean[]): Completeness {
  return { filled: flags.filter(Boolean).length, total: flags.length };
}

export function fixtureCompleteness(f: NormalisedFixture): Completeness {
  const finished = f.status === 'finished' || f.status === 'awarded';
  return count([
    f.stage !== null,
    f.round !== null,
    f.venue !== null,
    f.venue?.externalId != null,
    f.venue?.city != null,
    f.referee !== null,
    f.referee?.externalId != null,
    f.scores.halfTime !== null,
    ...(finished ? [f.scores.fullTime !== null, f.scores.current !== null] : []),
  ]);
}

export function lineupCompleteness(l: NormalisedLineup): Completeness {
  const sides = [l.home, l.away];
  return count(
    sides.flatMap((side) => {
      const starters = side.players.filter((p) => p.role === 'starter');
      return [
        side.formation !== null,
        side.coach !== null,
        starters.length === 11,
        side.players.some((p) => p.role === 'bench'),
        side.players.every((p) => p.shirtNumber !== null),
        side.players.every((p) => p.position !== null),
        side.players.some((p) => p.isCaptain),
      ];
    }),
  );
}

export function standingCompleteness(s: NormalisedStanding): Completeness {
  return count([s.rows.every((row) => row.form !== null), s.stage !== null]);
}

/** Detail: the fixture's own fields plus what a match centre wants afterwards. */
export function detailCompleteness(d: NormalisedFixtureDetail): Completeness {
  const metrics = new Set(d.statistics.map((s) => s.metric));
  const perSide = count(STAT_METRICS.map((metric) => metrics.has(metric)));
  return add(
    add(fixtureCompleteness(d.fixture), d.lineup === null ? EMPTY : lineupCompleteness(d.lineup)),
    add(count([d.incidents.length > 0, d.lineup !== null, d.periods.length > 0]), {
      filled: perSide.filled,
      total: perSide.total,
    }),
  );
}

// ---------------------------------------------------------------------------
// Cross-provider matching and disagreement
// ---------------------------------------------------------------------------

/** "Manchester City FC" and "Manchester City" are the same club to the bake-off. */
export function normaliseTeamName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(fc|afc|cf|sc|ac|club)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Kick-off to the minute plus both team names: the key two providers share. */
export function matchKey(f: NormalisedFixture): string {
  const kickoff = new Date(f.kickoffAt).toISOString().slice(0, 16);
  return `${kickoff} ${normaliseTeamName(f.home.name)} v ${normaliseTeamName(f.away.name)}`;
}

export interface Disagreement {
  key: string;
  field: 'status' | 'fullTime' | 'current' | 'halfTime';
  values: Record<string, string>;
}

const scoreText = (s: { home: number; away: number } | null): string =>
  s === null ? 'null' : `${s.home}-${s.away}`;

/**
 * Where providers describe the same match differently. A field only counts
 * when at least two providers supplied it: a missing value is a completeness
 * gap, not a contradiction.
 */
export function disagreements(
  fixturesByProvider: Record<string, readonly NormalisedFixture[]>,
): Disagreement[] {
  const byKey = new Map<string, Record<string, NormalisedFixture>>();
  for (const [provider, fixtures] of Object.entries(fixturesByProvider)) {
    for (const fixture of fixtures) {
      const key = matchKey(fixture);
      const entry = byKey.get(key) ?? {};
      entry[provider] = fixture;
      byKey.set(key, entry);
    }
  }

  const out: Disagreement[] = [];
  for (const [key, entry] of byKey) {
    const providers = Object.keys(entry);
    if (providers.length < 2) continue;
    const fields: [Disagreement['field'], (f: NormalisedFixture) => string | null][] = [
      ['status', (f) => f.status],
      ['fullTime', (f) => (f.scores.fullTime === null ? null : scoreText(f.scores.fullTime))],
      ['current', (f) => (f.scores.current === null ? null : scoreText(f.scores.current))],
      ['halfTime', (f) => (f.scores.halfTime === null ? null : scoreText(f.scores.halfTime))],
    ];
    for (const [field, read] of fields) {
      const values: Record<string, string> = {};
      for (const provider of providers) {
        const fixture = entry[provider];
        const value = fixture === undefined ? null : read(fixture);
        if (value !== null) values[provider] = value;
      }
      if (Object.keys(values).length >= 2 && new Set(Object.values(values)).size > 1) {
        out.push({ key, field, values });
      }
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key) || a.field.localeCompare(b.field));
}
