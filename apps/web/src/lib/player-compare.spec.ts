import type { PlayerPage, PlayerSeasonRecord } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  REASON,
  cellText,
  compareHref,
  compareRows,
  pickerQuery,
  readCompareWith,
  readScope,
  resolveScope,
  rowNote,
  scopesOf,
  sideTotals,
} from './player-compare';

/** The compare page's alignment and coverage rules (T-631). */

const S24 = '00000000-0000-4000-8000-000000002024';
const S25 = '00000000-0000-4000-8000-000000002025';
const LEAGUE = '00000000-0000-4000-8000-00000000000a';
const CUP = '00000000-0000-4000-8000-00000000000b';

function row(
  season: string,
  competition: string,
  overrides: Partial<PlayerSeasonRecord> = {},
): PlayerSeasonRecord {
  return {
    season: { id: season, label: season === S24 ? '2024/25' : '2025/26' },
    competition: {
      id: competition,
      name: competition === LEAGUE ? 'League' : 'Cup',
      short_name: null,
    },
    team: { id: 't1', name: 'T1' },
    starts: 3,
    sub_appearances: 1,
    goals: 2,
    assists: 1,
    yellow_cards: 1,
    red_cards: 0,
    minutes: {
      coverage: 'available',
      total: 300,
      matches: 4,
      matches_with_minutes: 4,
      supplied_minutes: 300,
    },
    ...overrides,
  };
}

function record(rows: PlayerSeasonRecord[] | null): PlayerPage['record'] {
  return rows === null
    ? { coverage: 'not_supplied', last_updated_at: null, data: null }
    : { coverage: 'available', last_updated_at: '2025-09-01T00:00:00.000Z', data: rows };
}

describe('readCompareWith', () => {
  it('reads a UUID, lower-cased', () => {
    expect(readCompareWith({ with: S25.toUpperCase() })).toEqual({ state: 'id', id: S25 });
  });
  it('treats an absent or empty value as the picker', () => {
    expect(readCompareWith({})).toEqual({ state: 'absent' });
    expect(readCompareWith({ with: ' ' })).toEqual({ state: 'absent' });
  });
  it('calls anything else malformed, never a player', () => {
    expect(readCompareWith({ with: 'messi' })).toEqual({ state: 'malformed' });
  });
});

describe('scopes', () => {
  const a = record([row(S25, LEAGUE), row(S24, LEAGUE), row(S24, CUP)]);
  const b = record([row(S25, CUP), row(S24, LEAGUE)]);

  it('lists every season-and-competition once, newest first, marking the shared ones', () => {
    const scopes = scopesOf(a, b);
    expect(scopes.map((s) => [s.season.label, s.competition.name, s.shared])).toEqual([
      ['2025/26', 'Cup', false],
      ['2025/26', 'League', false],
      ['2024/25', 'Cup', false],
      ['2024/25', 'League', true],
    ]);
  });

  it('defaults to the newest shared scope', () => {
    expect(resolveScope(null, scopesOf(a, b))?.key).toBe(`${S24}:${LEAGUE}`);
  });

  it('honours a requested scope either player has, and ignores one neither has', () => {
    const scopes = scopesOf(a, b);
    expect(resolveScope(readScope({ season: S25, competition: CUP }), scopes)?.key).toBe(
      `${S25}:${CUP}`,
    );
    const unknown = '00000000-0000-4000-8000-00000000000c';
    expect(resolveScope(readScope({ season: S25, competition: unknown }), scopes)?.key).toBe(
      `${S24}:${LEAGUE}`,
    );
  });

  it('falls back to everything on record when nothing is shared', () => {
    expect(resolveScope(null, scopesOf(record([row(S25, LEAGUE)]), record(null)))).toBeNull();
  });

  it('reads no scope from half a pair or a non-UUID', () => {
    expect(readScope({ season: S25 })).toBeNull();
    expect(readScope({ season: S25, competition: 'cup' })).toBeNull();
  });
});

describe('sideTotals', () => {
  it('sums a season split across two teams', () => {
    const side = sideTotals(
      record([row(S25, LEAGUE), row(S25, LEAGUE, { team: { id: 't2', name: 'T2' }, goals: 5 })]),
      scopesOf(record([row(S25, LEAGUE)]), record(null))[0] ?? null,
    );
    expect(side).toMatchObject({ held: true, totals: { starts: 6, goals: 7 } });
  });

  it('holds nothing, rather than zeros, when the player has no line-ups', () => {
    expect(sideTotals(record(null), null)).toEqual({ held: false, reason: REASON.noLineups });
  });

  it('holds nothing, rather than zeros, outside the scopes the player has a record in', () => {
    const scope = scopesOf(record([row(S25, CUP)]), record(null))[0] ?? null;
    expect(sideTotals(record([row(S24, LEAGUE)]), scope)).toEqual({
      held: false,
      reason: REASON.notInScope,
    });
  });
});

describe('compareRows', () => {
  const a = record([row(S25, LEAGUE, { goals: 4 })]);

  it('puts both numbers side by side when both hold them, zeros included', () => {
    const b = record([row(S25, LEAGUE, { goals: 0 })]);
    const goals = compareRows(a, b, resolveScope(null, scopesOf(a, b))).find(
      (r) => r.key === 'goals',
    );
    expect(goals).toMatchObject({ a: { value: 4 }, b: { value: 0 }, lacking: null });
  });

  it('makes a figure one side lacks a coverage state with a reason, never a zero', () => {
    const rows = compareRows(a, record(null), null);
    const goals = rows.find((r) => r.key === 'goals');
    expect(goals?.b).toEqual({ coverage: 'not_supplied', value: null, reason: REASON.noLineups });
    expect(goals?.lacking).toBe('b');
    expect(cellText(goals!.b)).toBe('not supplied');
    expect(rowNote(goals!, 'Ann', 'Bea')).toBe(
      'Bea: no line-ups on record, so this is not a comparison.',
    );
  });

  it('puts minutes side by side when the feed supplied them for every match (T-823)', () => {
    const b = record([
      row(S25, LEAGUE, {
        minutes: {
          coverage: 'available',
          total: 0,
          matches: 0,
          matches_with_minutes: 0,
          supplied_minutes: 0,
        },
      }),
    ]);
    const minutes = compareRows(a, b, null).find((r) => r.key === 'minutes');
    expect(minutes).toMatchObject({ a: { value: 300 }, b: { value: 0 }, lacking: null });
    expect(rowNote(minutes!, 'Ann', 'Bea')).toBeNull();
  });

  it('never invents minutes: not supplied only where the feed sent none', () => {
    const none = record([
      row(S25, LEAGUE, {
        minutes: {
          coverage: 'not_supplied',
          total: null,
          matches: 4,
          matches_with_minutes: 0,
          supplied_minutes: 0,
        },
      }),
    ]);
    const one = compareRows(a, none, null).find((r) => r.key === 'minutes');
    expect(one).toMatchObject({ a: { value: 300 }, b: { value: null }, lacking: 'b' });
    expect(rowNote(one!, 'Ann', 'Bea')).toBe(
      'Bea: no minutes from the feed, so this is not a comparison.',
    );
    const both = compareRows(none, none, null).find((r) => r.key === 'minutes');
    expect(rowNote(both!, 'Ann', 'Bea')).toBe('No minutes from the feed for either player.');
  });

  it('marks a partial season "at least", limited, never a smaller number as whole', () => {
    // Two teams in one season: one row whole, one with a match missing minutes.
    const moved = record([
      row(S25, LEAGUE),
      row(S25, LEAGUE, {
        team: { id: 't2', name: 'T2' },
        minutes: {
          coverage: 'limited',
          total: null,
          matches: 3,
          matches_with_minutes: 2,
          supplied_minutes: 150,
        },
      }),
    ]);
    const minutes = compareRows(moved, a, null).find((r) => r.key === 'minutes');
    expect(minutes?.a).toEqual({
      coverage: 'limited',
      value: 450,
      partial: { counted: 6, of: 7 },
    });
    expect(cellText(minutes!.a)).toBe('at least 450');
    expect(cellText(minutes!.b)).toBe('300');
    expect(minutes?.lacking).toBeNull();
    expect(rowNote(minutes!, 'Ann', 'Bea')).toBe(
      'Ann: minutes for 6 of 7 matches played; the rest were not supplied.',
    );
  });

  it('carries a limited record’s coverage onto its numbers', () => {
    const limited: PlayerPage['record'] = { ...a, coverage: 'limited' };
    const apps = compareRows(limited, a, null).find((r) => r.key === 'appearances');
    expect(apps?.a).toEqual({ coverage: 'limited', value: 4 });
  });

  it('gives every figure a row in a fixed order', () => {
    expect(compareRows(a, a, null).map((r) => r.key)).toEqual([
      'appearances',
      'starts',
      'sub_appearances',
      'minutes',
      'goals',
      'assists',
      'yellow_cards',
      'red_cards',
    ]);
  });
});

describe('links and queries', () => {
  it('builds the compare URL with and without a scope', () => {
    expect(compareHref('en', 'a', 'b')).toBe('/en/player/a/compare?with=b');
    const scope = scopesOf(record([row(S25, LEAGUE)]), record(null))[0]!;
    expect(compareHref('fa', 'a', 'b', scope)).toBe(
      `/fa/player/a/compare?with=b&season=${S25}&competition=${LEAGUE}`,
    );
  });

  it('searches people only, and not at all below the minimum length', () => {
    expect(pickerQuery('Ronaldo')).toBe('q=Ronaldo&limit=10&types=person');
    expect(pickerQuery('R')).toBeNull();
  });
});
