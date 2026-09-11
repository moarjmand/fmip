import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApiFootballAdapter } from '../adapters/api-football';
import { createFootballDataOrgAdapter } from '../adapters/football-data-org';
import { createHighlightlyAdapter } from '../adapters/highlightly';
import { loadScenarios } from '../harness/contract-check';
import type { NormalisedFixture } from '../normalised';
import {
  disagreements,
  fixtureCompleteness,
  matchKey,
  normaliseTeamName,
  percent,
} from './metrics';
import { END_MARKER, PLACEHOLDER, START_MARKER, insertResults, renderMarkdown } from './report';
import { runRecorded } from './run';

const FIXTURES = join(__dirname, '..', 'adapters', '_fixtures');

const fixture = (over: Partial<NormalisedFixture> = {}): NormalisedFixture => ({
  externalId: '1',
  competition: { externalId: '39', name: 'Premier League' },
  season: { label: '2023/24', startYear: 2023 },
  stage: null,
  round: null,
  kickoffAt: '2023-08-11T19:00:00Z',
  status: 'finished',
  minute: null,
  home: { externalId: '44', name: 'Burnley FC' },
  away: { externalId: '50', name: 'Manchester City' },
  venue: null,
  referee: null,
  scores: {
    current: { home: 0, away: 3 },
    halfTime: null,
    fullTime: { home: 0, away: 3 },
    extraTime: null,
    penalties: null,
    aggregate: null,
  },
  lastUpdatedAt: '2023-08-11T21:00:00Z',
  ...over,
});

describe('metrics', () => {
  it('matches the same club across providers by name and kick-off', () => {
    expect(normaliseTeamName('Manchester City FC')).toBe('manchester city');
    expect(normaliseTeamName('Atlético Madrid')).toBe('atletico madrid');
    expect(matchKey(fixture())).toBe(
      matchKey(
        fixture({
          home: { externalId: '9', name: 'Burnley' },
          kickoffAt: '2023-08-11T20:00:00+01:00',
        }),
      ),
    );
  });

  it('counts only fields a provider could have filled', () => {
    const bare = fixtureCompleteness(fixture());
    expect(bare.total).toBe(10);
    expect(bare.filled).toBe(2); // current and fullTime
    const rich = fixtureCompleteness(
      fixture({
        stage: { name: 'Regular Season', kind: 'league' },
        round: 'Regular Season - 1',
        venue: { externalId: '512', name: 'Turf Moor', city: 'Burnley' },
        referee: { externalId: null, name: 'C. Pawson' },
        scores: { ...fixture().scores, halfTime: { home: 0, away: 2 } },
      }),
    );
    expect(percent(rich)).toBe(90);
    expect(percent(fixtureCompleteness(fixture({ status: 'scheduled' })))).toBe(0);
  });

  it('reports a disagreement only where two providers supplied different values', () => {
    const list = disagreements({
      a: [fixture()],
      b: [
        fixture({
          externalId: 'x',
          scores: { ...fixture().scores, fullTime: { home: 1, away: 3 } },
        }),
      ],
      c: [
        fixture({
          externalId: 'y',
          scores: { ...fixture().scores, halfTime: { home: 0, away: 2 } },
        }),
      ],
    });
    expect(list).toEqual([
      {
        key: matchKey(fixture()),
        field: 'fullTime',
        values: { a: '0-3', b: '1-3', c: '0-3' },
      },
    ]);
  });
});

describe('recorded run over the three providers', () => {
  const providers = [
    { factory: createApiFootballAdapter, scenarios: loadScenarios(join(FIXTURES, 'api-football')) },
    {
      factory: createFootballDataOrgAdapter,
      scenarios: loadScenarios(join(FIXTURES, 'football-data-org')),
    },
    { factory: createHighlightlyAdapter, scenarios: loadScenarios(join(FIXTURES, 'highlightly')) },
  ];

  it('measures every provider from its recordings and finds the shared fixtures', async () => {
    const result = await runRecorded(providers, 'recordings');
    expect(result.mode).toBe('recorded');
    expect(result.summaries.map((s) => s.provider)).toEqual([
      'api_football',
      'football_data_org',
      'highlightly',
    ]);
    for (const s of result.summaries) {
      expect(s.calls).toBe(6);
      expect(s.ok).toBeGreaterThanOrEqual(4);
      expect(s.requests).toBeGreaterThanOrEqual(6);
      expect(s.completeness.fixture).not.toBeNull();
      expect(s.meanLatencyMs).toBeNull();
    }
    // The three opening-weekend lists describe the same ten matches.
    const shared = result.calls.filter((c) => c.call === 'listFixtures' && c.ok);
    expect(shared.map((c) => c.items)).toEqual([10, 10, 10]);
    // Highlightly's list cost four requests; the others one.
    expect(
      result.calls.find((c) => c.provider === 'highlightly' && c.call === 'listFixtures')?.requests,
    ).toBe(4);
  });

  it('renders a table per provider and slots it into the document once', async () => {
    const result = await runRecorded(providers, 'recordings');
    const markdown = renderMarkdown(result);
    expect(markdown).toContain('| API-Football (api-sports.io) |');
    expect(markdown).toContain('| football-data.org |');
    expect(markdown).toContain('| Highlightly |');
    expect(markdown).toContain('goal latency');

    const first = insertResults(`intro\n\n${PLACEHOLDER}\n\nrest`, markdown);
    expect(first).toContain(START_MARKER);
    expect(first).not.toContain(PLACEHOLDER);
    const second = insertResults(first, 'REPLACED');
    expect(second).toBe(`intro\n\n${START_MARKER}\nREPLACED\n${END_MARKER}\n\nrest`);
    expect(() => insertResults('no markers here', 'x')).toThrow();
  });
});
