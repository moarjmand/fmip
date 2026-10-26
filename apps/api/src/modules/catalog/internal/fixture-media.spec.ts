import type { Covered, EntityMedia, TableContext, TeamPageFixture } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  contextTeamIds,
  fixtureTeamIds,
  withContextCrests,
  withCrests,
  withFixtureMedia,
} from './fixture-media';

/**
 * Crests and logos on the lists of matches (T-1617): each side's crest and
 * the competition's logo from the page's one media read, `not_supplied` for
 * an entity with none, never a stand-in (rule 3).
 */

const HELD = new Set(['home-1', 'league-1']);
const media = {
  crest: (id: string): EntityMedia =>
    HELD.has(id)
      ? { coverage: 'available', url: `/api/media/crest/${id}/0123456789ab.png` }
      : { coverage: 'not_supplied', url: null },
  logo: (id: string): EntityMedia =>
    HELD.has(id)
      ? { coverage: 'available', url: `/api/media/logo/${id}/0123456789ab.png` }
      : { coverage: 'not_supplied', url: null },
};

const fixture = (id: string, home: string, away: string): TeamPageFixture => ({
  id,
  kickoff_at: '2026-10-24T14:00:00.000Z',
  status: 'finished',
  round: 'Regular Season - 9',
  stage: null,
  home: { id: home, name: home, short_name: null },
  away: { id: away, name: away, short_name: null },
  score: { home: 2, away: 1 },
  competition: { id: 'league-1', name: 'League', short_name: null },
  season: { id: 's', label: '2026/27' },
  after_extra_time: false,
  penalties: null,
});

describe('fixture media (T-1617)', () => {
  it('names every team of the list once, for one read', () => {
    expect(
      fixtureTeamIds([fixture('f1', 'home-1', 'away-1'), fixture('f2', 'away-1', 'home-1')]),
    ).toEqual(['home-1', 'away-1']);
    expect(fixtureTeamIds([])).toEqual([]);
  });

  it("puts each side's crest on the fixture, and says so where none is held", () => {
    const out = withCrests(fixture('f1', 'home-1', 'away-1'), media);
    expect(out.home.crest).toEqual({
      coverage: 'available',
      url: '/api/media/crest/home-1/0123456789ab.png',
    });
    expect(out.away.crest).toEqual({ coverage: 'not_supplied', url: null });
    // Nothing else moves.
    expect(out.score).toEqual({ home: 2, away: 1 });
    expect(out.home.name).toBe('home-1');
  });

  it("adds the competition's logo on a team page's fixture", () => {
    const out = withFixtureMedia(fixture('f1', 'home-1', 'away-1'), media);
    expect(out.competition.logo).toEqual({
      coverage: 'available',
      url: '/api/media/logo/league-1/0123456789ab.png',
    });
    expect(out.home.crest?.coverage).toBe('available');
    expect(out.after_extra_time).toBe(false);
  });

  it('puts the crests on the rows around the club, and leaves a context without rows alone', () => {
    const row = (id: string, position: number) => ({
      position,
      team: { id, name: id, short_name: null },
      played: 1,
      won: 1,
      drawn: 0,
      lost: 0,
      goals_for: 1,
      goals_against: 0,
      goal_difference: 1,
      points: 3,
      form: [],
    });
    const context: Covered<TableContext> = {
      coverage: 'available',
      last_updated_at: null,
      data: { position: 1, total: 2, points: 3, rows: [row('home-1', 1), row('away-1', 2)] },
    };
    expect(contextTeamIds(context)).toEqual(['home-1', 'away-1']);
    const out = withContextCrests(context, media);
    expect(out.data?.rows.map((r) => r.team.crest?.coverage)).toEqual([
      'available',
      'not_supplied',
    ]);
    const none: Covered<TableContext> = {
      coverage: 'not_supplied',
      last_updated_at: null,
      data: null,
    };
    expect(contextTeamIds(none)).toEqual([]);
    expect(withContextCrests(none, media)).toBe(none);
  });
});
