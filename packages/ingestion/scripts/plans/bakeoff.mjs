// The live bake-off's fixture set (T-024). The protocol asks for twenty matches
// across the five target leagues plus the Champions League over seven days;
// the free plans serve past seasons only (API-Football: 2022–2024), so the
// set is the 2023/24 opening weekend of the leagues every plan serves, and
// each run is one day's snapshot. Rerun daily to accumulate; the table in
// docs/05-data-providers.md always shows the latest run, the JSON under
// packages/ingestion/bakeoff/ keeps them all.

export default {
  fixtureSet: '2023/24 opening weekends: Premier League, La Liga, Bundesliga, Serie A, Ligue 1',
  detailSample: 2,
  competitions: [
    {
      label: 'Premier League',
      ids: { api_football: '39', football_data_org: '2021', highlightly: '33973' },
      seasonLabel: '2023/24',
      from: '2023-08-11',
      to: '2023-08-13',
    },
    {
      label: 'La Liga',
      ids: { api_football: '140', football_data_org: '2014' },
      seasonLabel: '2023/24',
      from: '2023-08-11',
      to: '2023-08-13',
    },
    {
      label: 'Bundesliga',
      ids: { api_football: '78', football_data_org: '2002' },
      seasonLabel: '2023/24',
      from: '2023-08-18',
      to: '2023-08-20',
    },
    {
      label: 'Serie A',
      ids: { api_football: '135', football_data_org: '2019' },
      seasonLabel: '2023/24',
      from: '2023-08-19',
      to: '2023-08-21',
    },
    {
      label: 'Ligue 1',
      ids: { api_football: '61', football_data_org: '2015' },
      seasonLabel: '2023/24',
      from: '2023-08-11',
      to: '2023-08-13',
    },
  ],
};
