// What to record from Highlightly on the BASIC plan (T-023): the same Premier
// League 2023/24 fixtures as the other two providers (league 33973). The
// opening weekend costs one request per day (four); the live call one per
// fixture (two). The lineup of a 2023 match is empty on this plan and is
// recorded as `unsupported`; an unknown match id answers an empty array.

const OPENING_WEEKEND = {
  competitionExternalId: '33973',
  seasonLabel: '2023/24',
  from: '2023-08-11',
  to: '2023-08-14',
};

const BURNLEY_MAN_CITY = '880817271';

export default {
  envKey: 'HIGHLIGHTLY_KEY',
  factory: (dist) => dist.createHighlightlyAdapter,
  pauseMs: 2000,
  scenarios: [
    { name: 'list-fixtures-opening-weekend', call: 'listFixtures', args: [OPENING_WEEKEND] },
    {
      name: 'standings-final-table',
      call: 'getStandings',
      args: [{ competitionExternalId: '33973', seasonLabel: '2023/24' }],
    },
    { name: 'lineup-empty-on-plan', call: 'getLineup', args: [BURNLEY_MAN_CITY] },
    { name: 'detail-burnley-man-city', call: 'getFixtureDetail', args: [BURNLEY_MAN_CITY] },
    {
      name: 'live-by-ids-one-unknown',
      call: 'getLive',
      args: [{ fixtureExternalIds: [BURNLEY_MAN_CITY, '1'] }],
    },
    { name: 'detail-unknown-match', call: 'getFixtureDetail', args: ['1'] },
  ],
};
