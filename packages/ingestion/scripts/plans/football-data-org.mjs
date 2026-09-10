// What to record from football-data.org on the free tier (T-022). Premier
// League (competition 2021) 2023/24, the same fixtures as the API-Football
// recordings so the bake-off can compare like with like: the opening weekend,
// the final table, Burnley v Manchester City's lineup (paid: expect
// `unsupported`) and detail, the same two matches through the live call, and
// a competition the tier does not serve (the Europa League, 2146; the
// Championship, 2016, turned out to be served: 12 fixtures, so it proves nothing).

const OPENING_WEEKEND = {
  competitionExternalId: '2021',
  seasonLabel: '2023/24',
  from: '2023-08-11',
  to: '2023-08-14',
};

const BURNLEY_MAN_CITY = '435943';

export default {
  envKey: 'FOOTBALL_DATA_ORG_KEY',
  factory: (dist) => dist.createFootballDataOrgAdapter,
  pauseMs: 7000,
  scenarios: [
    { name: 'list-fixtures-opening-weekend', call: 'listFixtures', args: [OPENING_WEEKEND] },
    {
      name: 'standings-final-table',
      call: 'getStandings',
      args: [{ competitionExternalId: '2021', seasonLabel: '2023/24' }],
    },
    { name: 'lineup-not-on-free-tier', call: 'getLineup', args: [BURNLEY_MAN_CITY] },
    { name: 'detail-burnley-man-city', call: 'getFixtureDetail', args: [BURNLEY_MAN_CITY] },
    {
      name: 'live-by-ids-finished',
      call: 'getLive',
      args: [{ fixtureExternalIds: [BURNLEY_MAN_CITY, '435944'] }],
    },
    {
      name: 'list-fixtures-competition-not-on-tier',
      call: 'listFixtures',
      args: [{ ...OPENING_WEEKEND, competitionExternalId: '2146' }],
    },
  ],
};
