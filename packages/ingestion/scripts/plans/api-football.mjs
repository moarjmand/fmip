// What to record from API-Football on the free plan (T-021). The free plan
// serves a window of past seasons only, so the scenarios use Premier League
// (league 39) 2023/24: the opening weekend, its table, one fixture's lineup
// and detail, everything live at recording time, and a season the plan
// does not serve, so the "unsupported" path is recorded too.

const OPENING_WEEKEND = {
  competitionExternalId: '39',
  seasonLabel: '2023/24',
  from: '2023-08-11',
  to: '2023-08-14',
};

// Burnley v Manchester City, Friday 11 August 2023, the season's first match.
const BURNLEY_MAN_CITY = '1035037';

export default {
  envKey: 'API_FOOTBALL_KEY',
  factory: (dist) => dist.createApiFootballAdapter,
  pauseMs: 7000,
  scenarios: [
    { name: 'list-fixtures-opening-weekend', call: 'listFixtures', args: [OPENING_WEEKEND] },
    {
      name: 'standings-final-table',
      call: 'getStandings',
      args: [{ competitionExternalId: '39', seasonLabel: '2023/24' }],
    },
    { name: 'lineup-burnley-man-city', call: 'getLineup', args: [BURNLEY_MAN_CITY] },
    { name: 'detail-burnley-man-city', call: 'getFixtureDetail', args: [BURNLEY_MAN_CITY] },
    // Whatever is in play at recording time; the free plan has no ids lookup.
    { name: 'live-all-now', call: 'getLive', args: [{ fixtureExternalIds: [] }] },
    {
      name: 'list-fixtures-season-not-on-plan',
      call: 'listFixtures',
      args: [{ ...OPENING_WEEKEND, seasonLabel: '2025/26', from: '2025-08-15', to: '2025-08-18' }],
    },
  ],
};
