import type { FavouriteIds } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  NO_FAVOURITES,
  type RankableFixture,
  compareByFavourites,
  favouriteRank,
} from './internal/favourite-order';

const LIV = 'team-liv';
const MUN = 'team-mun';
const RMA = 'team-rma';
const PER = 'team-per';
const PL = 'comp-pl';
const UCL = 'comp-ucl';

const fixture = (
  id: string,
  competitionId: string,
  home: string,
  away: string,
  kickoffAt: string,
): RankableFixture => ({
  id,
  competitionId,
  homeTeamId: home,
  awayTeamId: away,
  kickoffAt,
});

const prefs: FavouriteIds = {
  team_ids: [LIV],
  competition_ids: [UCL],
  person_ids: [],
  followed_team_ids: [LIV, MUN],
  followed_competition_ids: [UCL, PL],
};

describe('favouriteRank', () => {
  it('ranks a favourite team above a favourite competition above a followed team above a followed competition', () => {
    expect(favouriteRank(fixture('a', PL, LIV, RMA, '2026-01-01T15:00Z'), prefs)).toBe(0);
    expect(favouriteRank(fixture('b', UCL, RMA, PER, '2026-01-01T15:00Z'), prefs)).toBe(1);
    expect(favouriteRank(fixture('c', 'comp-other', MUN, RMA, '2026-01-01T15:00Z'), prefs)).toBe(2);
    expect(favouriteRank(fixture('d', PL, RMA, PER, '2026-01-01T15:00Z'), prefs)).toBe(3);
    expect(favouriteRank(fixture('e', 'comp-other', RMA, PER, '2026-01-01T15:00Z'), prefs)).toBe(4);
  });

  it('is indifferent with no favourites', () => {
    expect(favouriteRank(fixture('a', PL, LIV, RMA, '2026-01-01T15:00Z'), NO_FAVOURITES)).toBe(4);
  });
});

describe('compareByFavourites', () => {
  it('pins favourites first and keeps kick-off order inside a rank (T-042 acceptance)', () => {
    const list = [
      fixture('late-other', 'comp-other', RMA, PER, '2026-01-01T20:00Z'),
      fixture('early-other', 'comp-other', RMA, PER, '2026-01-01T12:00Z'),
      fixture('followed-pl', PL, RMA, PER, '2026-01-01T15:00Z'),
      fixture('fav-team-late', PL, LIV, RMA, '2026-01-01T20:00Z'),
      fixture('fav-comp', UCL, RMA, PER, '2026-01-01T15:00Z'),
      fixture('fav-team-early', 'comp-other', RMA, LIV, '2026-01-01T12:00Z'),
      fixture('followed-team', 'comp-other', MUN, RMA, '2026-01-01T15:00Z'),
    ];

    expect([...list].sort(compareByFavourites(prefs)).map((f) => f.id)).toEqual([
      'fav-team-early',
      'fav-team-late',
      'fav-comp',
      'followed-team',
      'followed-pl',
      'early-other',
      'late-other',
    ]);
  });

  it('with no favourites, orders by kick-off alone', () => {
    const list = [
      fixture('b', PL, LIV, RMA, '2026-01-01T15:00Z'),
      fixture('a', PL, MUN, RMA, '2026-01-01T12:00Z'),
    ];
    expect([...list].sort(compareByFavourites(NO_FAVOURITES)).map((f) => f.id)).toEqual(['a', 'b']);
  });
});
