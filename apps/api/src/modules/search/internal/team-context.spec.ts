import type { SearchResult, SearchTeamContext } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { teamIds, withTeamContexts } from './team-context';

/** Each team result's league and ground (T-1803, D-401): teams only, none invented. */

const result = (type: SearchResult['type'], id: string): SearchResult => ({
  type,
  id,
  name: id,
  secondary: null,
  matched_on: 'name',
  alias: null,
  score: 1,
});

const ARSENAL = '00000000-0000-4000-8000-0000000000AA';
const TIVAT = '00000000-0000-4000-8000-0000000000bb';
const LEAGUE = '00000000-0000-4000-8000-0000000000cc';

describe('team contexts on search results', () => {
  it('asks only for the teams', () => {
    expect(
      teamIds([result('team', ARSENAL), result('person', 'p'), result('competition', 'c')]),
    ).toEqual([ARSENAL]);
  });

  it('puts each team its own context, matched by id whatever its case', () => {
    const arsenal: SearchTeamContext = {
      league: { id: LEAGUE, name: 'Premier League' },
      ground: { id: 'g', name: 'Emirates Stadium', city: 'London' },
    };
    const out = withTeamContexts(
      [result('team', ARSENAL), result('team', TIVAT), result('person', 'p')],
      new Map([[ARSENAL.toLowerCase(), arsenal]]),
    );
    expect(out[0]?.team_context).toEqual(arsenal);
    // A team the query found nothing for has neither on record: both null, said so.
    expect(out[1]?.team_context).toEqual({ league: null, ground: null });
    // A person or a competition carries no team context at all.
    expect(out[2]).not.toHaveProperty('team_context');
  });
});
