import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  AdapterFactory,
  AdapterManifest,
  AdapterResult,
  ProviderAdapter,
  Transport,
} from '../adapters/_contract';
import type { NormalisedFixture } from '../normalised';
import {
  checkAdapterContract,
  loadScenarios,
  parseScenario,
  type Scenario,
} from './contract-check';
import { validateFixtureDetail, validateLineup, validateStanding } from './validate';

// ---------------------------------------------------------------------------
// A pretend provider, recorded once. The shape is deliberately unlike ours so
// that the fake adapter has real mapping to do.
// ---------------------------------------------------------------------------

const FIXTURES_URL =
  'https://provider.test/v1/matches?league=39&season=2024&from=2025-01-05&to=2025-01-05';

const recordedBody = {
  matches: [
    {
      id: 'm-1001',
      league: { id: '39', title: 'Premier League' },
      kickoff: '2025-01-05T16:30:00Z',
      state: 'FT',
      teams: {
        h: { id: '40', title: 'Liverpool' },
        a: { id: '33', title: 'Manchester United' },
      },
      goals: { ht: [0, 0], ft: [2, 2] },
      updated: '2025-01-05T18:25:12Z',
    },
  ],
};

const listFixturesScenario: Scenario = {
  name: 'list-fixtures-one-day',
  recordedAt: '2025-01-06T09:00:00Z',
  call: 'listFixtures',
  args: [
    { competitionExternalId: '39', seasonLabel: '2024/25', from: '2025-01-05', to: '2025-01-05' },
  ],
  expect: { ok: true, minItems: 1 },
  requests: [{ method: 'GET', url: FIXTURES_URL, status: 200, body: recordedBody }],
};

const lineupUnsupportedScenario: Scenario = {
  name: 'lineup-not-on-free-tier',
  recordedAt: '2025-01-06T09:00:00Z',
  call: 'getLineup',
  args: ['m-1001'],
  expect: { ok: false, errorKind: 'unsupported' },
  requests: [],
};

const manifest: AdapterManifest = {
  provider: 'api_football',
  displayName: 'Pretend Provider',
  criticalPath: true,
  licence: { kind: 'licensed_api', termsUrl: 'https://provider.test/terms', tier: 'free' },
  degradable: false,
  quota: { requestsPerDay: 100, requestsPerMinute: null },
};

type Tweak = Partial<{
  manifest: Partial<AdapterManifest>;
  url: string;
  throws: boolean;
  reportedRequests: number;
  mutate: (fixture: NormalisedFixture) => NormalisedFixture;
}>;

/** A conforming adapter, or a broken one when given a tweak. */
function makeFactory(tweak: Tweak = {}): AdapterFactory {
  return (transport: Transport): ProviderAdapter => {
    const unsupported = <T>(): Promise<AdapterResult<T>> =>
      Promise.resolve({
        ok: false,
        error: { kind: 'unsupported', message: 'not on this tier' },
        requests: 0,
      });

    return {
      manifest: { ...manifest, ...tweak.manifest },

      async listFixtures(query) {
        if (tweak.throws) throw new Error('provider exploded');

        const url =
          tweak.url ??
          `https://provider.test/v1/matches?league=${query.competitionExternalId}&season=2024&from=${query.from}&to=${query.to}`;
        const response = await transport.request(url);

        if (response.status !== 200) {
          return {
            ok: false,
            error: { kind: 'http', message: `HTTP ${response.status}`, status: response.status },
            requests: 1,
          };
        }

        const body = response.body as typeof recordedBody;
        const data = body.matches.map((m): NormalisedFixture => {
          const fixture: NormalisedFixture = {
            externalId: m.id,
            competition: { externalId: m.league.id, name: m.league.title },
            season: { label: query.seasonLabel, startYear: 2024 },
            stage: null,
            round: null,
            kickoffAt: m.kickoff,
            status: m.state === 'FT' ? 'finished' : 'scheduled',
            minute: null,
            home: { externalId: m.teams.h.id, name: m.teams.h.title },
            away: { externalId: m.teams.a.id, name: m.teams.a.title },
            venue: null,
            referee: null,
            scores: {
              current: { home: m.goals.ft[0] ?? 0, away: m.goals.ft[1] ?? 0 },
              halfTime: { home: m.goals.ht[0] ?? 0, away: m.goals.ht[1] ?? 0 },
              fullTime: { home: m.goals.ft[0] ?? 0, away: m.goals.ft[1] ?? 0 },
              extraTime: null,
              penalties: null,
              aggregate: null,
            },
            lastUpdatedAt: m.updated,
          };
          return tweak.mutate ? tweak.mutate(fixture) : fixture;
        });

        return {
          ok: true,
          data,
          requests: tweak.reportedRequests ?? 1,
          fetchedAt: response.receivedAt,
        };
      },

      getLive: () => unsupported(),
      getLineup: () => unsupported(),
      getStandings: () => unsupported(),
      getFixtureDetail: () => unsupported(),
    };
  };
}

const scenarios = [listFixturesScenario, lineupUnsupportedScenario];

describe('checkAdapterContract', () => {
  it('passes a conforming adapter with no problems', async () => {
    await expect(checkAdapterContract(makeFactory(), scenarios)).resolves.toEqual([]);
  });

  it('fails an adapter that does not normalise (T-020 acceptance)', async () => {
    const problems = await checkAdapterContract(
      makeFactory({
        mutate: (fixture) => ({
          ...fixture,
          // A provider status leaking through, a clock on a finished match,
          // and an impossible score. Each must be named separately.
          status: 'FT' as NormalisedFixture['status'],
          minute: 90,
          scores: { ...fixture.scores, fullTime: { home: 2, away: -1 } },
        }),
      }),
      scenarios,
    );

    const messages = problems.map((p) => `${p.path}: ${p.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/data\[0\]\.status: must be one of/),
        expect.stringMatching(/data\[0\]\.scores\.fullTime\.away: must be >= 0/),
      ]),
    );
    expect(problems.every((p) => p.scenario === 'list-fixtures-one-day')).toBe(true);
  });

  it('fails an adapter that fakes coverage on a finished match', async () => {
    const problems = await checkAdapterContract(
      makeFactory({ mutate: (f) => ({ ...f, scores: { ...f.scores, fullTime: null } }) }),
      scenarios,
    );

    expect(problems).toEqual([
      expect.objectContaining({
        path: 'data[0].scores.fullTime',
        message: 'a finished fixture must carry a full-time score',
      }),
    ]);
  });

  it('fails an adapter that requests something the recording does not contain', async () => {
    const problems = await checkAdapterContract(
      makeFactory({ url: 'https://provider.test/v2/matches' }),
      scenarios,
    );

    expect(problems.map((p) => p.path)).toContain('transport');
    expect(problems[0]?.message).toMatch(
      /unrecorded URL: GET https:\/\/provider\.test\/v2\/matches/,
    );
  });

  it('fails an adapter that throws instead of returning a result', async () => {
    const problems = await checkAdapterContract(makeFactory({ throws: true }), scenarios);

    expect(problems).toEqual([
      expect.objectContaining({
        scenario: 'list-fixtures-one-day',
        message: expect.stringContaining('threw instead of returning a result: provider exploded'),
      }),
    ]);
  });

  it('fails an adapter that misreports how many requests it made', async () => {
    const problems = await checkAdapterContract(makeFactory({ reportedRequests: 0 }), scenarios);

    expect(problems).toEqual([
      expect.objectContaining({
        path: 'result.requests',
        message: 'reports 0 requests but made 1',
      }),
    ]);
  });

  it('fails an adapter whose manifest breaks D-014', async () => {
    const problems = await checkAdapterContract(
      makeFactory({
        manifest: { licence: { kind: 'scraped', termsUrl: 'https://x.test', tier: 'free' } },
      }),
      scenarios,
    );

    expect(problems).toEqual([
      expect.objectContaining({ scenario: '<manifest>', path: 'manifest.licence.kind' }),
    ]);
    expect(problems[0]?.message).toMatch(/D-014/);
  });

  it('fails an adapter that succeeds where the recording says it must fail', async () => {
    const factory = makeFactory();
    const cheerful: AdapterFactory = (transport, config) => ({
      ...factory(transport, config),
      getLineup: () =>
        Promise.resolve({
          ok: true,
          data: {
            fixtureExternalId: 'm-1001',
            home: { formation: null, coach: null, players: [] },
            away: { formation: null, coach: null, players: [] },
          },
          requests: 0,
          fetchedAt: '2025-01-06T09:00:00Z',
        }),
    });

    const problems = await checkAdapterContract(cheerful, scenarios);

    expect(problems).toEqual([
      expect.objectContaining({
        scenario: 'lineup-not-on-free-tier',
        path: 'result.ok',
        message: 'expected failure of kind unsupported, received success',
      }),
    ]);
  });

  it('reports an adapter with no recordings as unverified rather than passing it', async () => {
    const problems = await checkAdapterContract(makeFactory(), []);

    expect(problems).toEqual([
      expect.objectContaining({
        scenario: '<scenarios>',
        message: expect.stringContaining('unverified'),
      }),
    ]);
  });
});

describe('scenario files', () => {
  it('rejects a scenario naming a call that is not in the contract', () => {
    expect(() =>
      parseScenario(
        {
          name: 'x',
          recordedAt: 'now',
          call: 'getOdds',
          args: [],
          expect: { ok: true },
          requests: [],
        },
        'x.json',
      ),
    ).toThrow(/call must be one of/);
  });

  it('loads nothing from an empty directory', () => {
    expect(loadScenarios(mkdtempSync(join(tmpdir(), 'fmip-scenarios-')))).toEqual([]);
  });
});

describe('validators', () => {
  it('rejects two captains and a duplicate shirt number on one side', () => {
    const problems = validateLineup({
      fixtureExternalId: 'm-1',
      home: {
        formation: '4-3-3',
        coach: null,
        players: [
          {
            externalId: 'p1',
            name: 'A',
            role: 'starter',
            shirtNumber: 1,
            position: 'goalkeeper',
            isCaptain: true,
          },
          {
            externalId: 'p2',
            name: 'B',
            role: 'starter',
            shirtNumber: 1,
            position: 'defender',
            isCaptain: true,
          },
        ],
      },
      away: { formation: null, coach: null, players: [] },
    });

    expect(problems.map((p) => p.message)).toEqual(
      expect.arrayContaining(['at most one captain per side', 'duplicate shirt number 1']),
    );
  });

  it('rejects a table row whose results do not add up', () => {
    const problems = validateStanding({
      competition: { externalId: '39', name: 'Premier League' },
      seasonLabel: '2024/25',
      stage: null,
      group: null,
      lastUpdatedAt: '2025-01-06T09:00:00Z',
      rows: [
        {
          position: 1,
          team: { externalId: '40', name: 'Liverpool' },
          played: 20,
          won: 14,
          drawn: 5,
          lost: 0,
          goalsFor: 50,
          goalsAgainst: 20,
          points: 47,
          form: 'WWDWW',
        },
      ],
    });

    expect(problems).toEqual([
      expect.objectContaining({
        path: 'standing.rows[0].played',
        message: 'won + drawn + lost must equal played',
      }),
    ]);
  });

  it('rejects an unmodelled statistic and a duplicated incident sequence', () => {
    const fixture = {
      externalId: 'm-1',
      competition: { externalId: '39', name: 'PL' },
      season: { label: '2024/25', startYear: 2024 },
      stage: null,
      round: null,
      kickoffAt: '2025-01-05T16:30:00Z',
      status: 'finished',
      minute: null,
      home: { externalId: '40', name: 'Liverpool' },
      away: { externalId: '33', name: 'Manchester United' },
      venue: null,
      referee: null,
      scores: {
        current: { home: 2, away: 2 },
        halfTime: null,
        fullTime: { home: 2, away: 2 },
        extraTime: null,
        penalties: null,
        aggregate: null,
      },
      lastUpdatedAt: '2025-01-05T18:25:12Z',
    };
    const incident = {
      fixtureExternalId: 'm-1',
      sequence: 1,
      minute: 70,
      addedTime: null,
      kind: 'goal',
      side: 'home',
      player: { externalId: 'p9', name: 'Salah' },
      relatedPlayer: null,
      detail: null,
    };

    const problems = validateFixtureDetail({
      fixture,
      incidents: [incident, { ...incident, minute: 80 }],
      lineup: null,
      statistics: [{ side: 'home', metric: 'dribbles', value: 3 }],
      periods: [],
    });

    expect(problems.map((p) => p.message)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^must be one of possession_pct/),
        'duplicate sequence 1',
      ]),
    );
  });
});
