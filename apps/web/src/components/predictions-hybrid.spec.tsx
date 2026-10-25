import type {
  AuthUser,
  CommunityConsensusResponse,
  ConsensusListEntry,
  ForecastEvaluation,
  ForecastVersion,
  Prediction,
  PublicModelAccuracyResponse,
  ScoreCard,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PredictionDay } from '@/lib/predictions-days';

vi.mock('@/lib/prediction-actions', () => ({ submitPredictionAction: async () => null }));

const { ForecastList, ModelExpected } = await import('./forecast-panel');
const { InlinePick } = await import('./prediction-section');
const { CommunityConsensusList } = await import('./community-consensus');
const { ModelAccuracyRecent } = await import('./model-accuracy');

/**
 * The Predictions page and the match report in the Hybrid design (T-1383,
 * D-201): the model's list by day with its disclosure, the pick in each row,
 * the community's spread held back until the reader picks, the model's
 * recent record, and "What the model expected" -- in English and in Persian,
 * and with the data missing.
 */

const FIXTURE = '00000000-0000-4000-8000-000000000901';
const OTHER = '00000000-0000-4000-8000-000000000902';

const card = (id: string, kickoff: string, home: string, away: string): ScoreCard =>
  ({
    id,
    kickoff_at: kickoff,
    competition: { id: 'c1', name: 'Persian Gulf Pro League', short_name: null, country_id: null },
    home: { id: 'h', name: home },
    away: { id: 'a', name: away },
  }) as unknown as ScoreCard;

const TRACTOR = card(FIXTURE, '2099-10-08T13:30:00Z', 'Tractor', 'Esteghlal');
const SEPAHAN = card(OTHER, '2099-10-08T14:45:00Z', 'Sepahan', 'Fajr');
const DAY: PredictionDay = {
  date: '2099-10-08',
  count: 2,
  competitions: [{ id: 'c1', name: 'Persian Gulf Pro League', fixtures: [TRACTOR, SEPAHAN] }],
};

const version = (n: number, p: [number, number, number] | null): ForecastVersion => ({
  id: `v${n}`,
  fixture_id: FIXTURE,
  version_number: n,
  kind: 'early',
  model_version: n === 1 ? 'dixon-coles@1.0.0' : 'dixon-coles-elo@0.6.0',
  computed_at: `2099-10-0${n}T09:30:00.000Z`,
  status: p === null ? 'unavailable' : 'available',
  probabilities: p === null ? null : { home: p[0], draw: p[1], away: p[2] },
  expected_goals: p === null ? null : { home: 1.42, away: 0.97 },
  most_likely_scorelines:
    p === null
      ? null
      : [
          { home: 1, away: 0, probability: 0.121 },
          { home: 1, away: 1, probability: 0.114 },
          { home: 0, away: 0, probability: 0.09 },
        ],
  leading_factors: null,
  data_completeness: 'available',
  inputs: null,
  unavailable_reason: p === null ? 'no_history' : null,
  unavailable_detail: null,
});

const V1 = version(1, [0.295, 0.558, 0.147]);
const V2 = version(2, [0.46, 0.34, 0.2]);

const list = (extra: Partial<Parameters<typeof ForecastList>[0]> = {}, locale = 'en'): string =>
  renderToStaticMarkup(
    <ForecastList
      days={[DAY]}
      entries={[
        { fixture_id: FIXTURE, latest: V2 },
        { fixture_id: OTHER, latest: null },
      ]}
      histories={{ [FIXTURE]: [V1, V2] }}
      picks={{ [FIXTURE]: <span data-testid="slot">pick</span> }}
      omitted={0}
      today="2099-10-08"
      timeZone="UTC"
      locale={locale}
      {...extra}
    />,
  );

describe('ForecastList by day', () => {
  it('heads the day "Today" with its date and count, then the competition, then each match', () => {
    const html = list();
    expect(html).toContain('data-testid="predictions-model"');
    expect(html).toContain('id="model"');
    expect(html).toMatch(/Today<span[^>]*>Thursday 8 October · 2 matches/);
    expect(html).toContain('Persian Gulf Pro League');
    expect(html.match(/data-testid="model-row"/g)).toHaveLength(2);
    // The zone in words (T-1391, D-207): "UTC", never "UTC time" or "Times in UTC".
    expect(html).toContain('Times: UTC');
    // The serif display for the editorial heading.
    expect(html).toMatch(/<h2 class="font-serif text-display-1/);
  });

  it('draws the compact bar for a forecast and the sentence for a match without one (rule 3)', () => {
    const html = list();
    expect(html).toContain('data-state="available"');
    expect(html).toContain('46.0%');
    expect(html).toContain('No model forecast for this match yet.');
    // Only a match with a version gets the disclosure.
    expect(html.match(/<details/g)).toHaveLength(1);
  });

  it('opens, without script, to expected goals, the likeliest scorelines and every stored version', () => {
    const html = list();
    expect(html).toContain('Expected goals, likeliest scorelines and versions');
    expect(html).toContain('1.42');
    expect(html).toContain('0.97');
    expect(html).toContain('not live xG');
    expect(html).toContain('12.1%');
    const rows = [...html.matchAll(/data-testid="model-version" data-current="(\w+)"/g)].map(
      (m) => m[1],
    );
    // Newest first; the old version kept, never edited.
    expect(rows).toEqual(['true', 'false']);
    expect(html).toContain('Superseded · kept');
    expect(html).toContain('55.8%');
    expect(html).toContain('dixon-coles<span>@</span>1.0.0');
    expect(html).toContain('href="/en/match/00000000-0000-4000-8000-000000000901#forecast"');
  });

  it('says where the earlier versions are when they were not read, rather than showing one row as all', () => {
    const html = list({ histories: {} });
    expect(html.match(/data-testid="model-version"/g)).toHaveLength(1);
    expect(html).toContain('1 earlier version is kept on the match page.');
  });

  it('puts the pick in the row as a slot it does not read, and says the service is down when it is', () => {
    expect(list()).toContain('<span data-testid="slot">pick</span>');
    const down = list({ entries: null });
    expect(down.match(/data-state="unreachable"/g)).toHaveLength(2);
    expect(down).not.toContain('<details');
  });

  it('counts the matches the cap left out', () => {
    expect(list({ omitted: 4 })).toContain('4 more matches in these days are not listed here.');
  });

  it('reads right to left in Persian, with Persian digits and the day in Persian', () => {
    const html = list({}, 'fa');
    expect(html).toContain('امروز');
    expect(html).toContain('۴۶٫۰٪');
    expect(html).toContain('۱٫۴۲');
    expect(html).toContain('ساعت‌ها به وقت UTC');
    // Home first in the source, so the direction puts it on the right.
    const order = [...html.matchAll(/<span data-segment="(\w+)"/g)].map((m) => m[1]);
    expect(order.slice(0, 3)).toEqual(['home', 'draw', 'away']);
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
  });
});

const ME = { id: 'u1', email_verified: true } as AuthUser;
const PICK = {
  id: 'p1',
  fixture_id: FIXTURE,
  locks_at: TRACTOR.kickoff_at,
  locked: true,
  latest: {
    id: 'pv1',
    version_number: 1,
    outcome: 'home',
    score: null,
    confidence: 3,
    reason_tags: [],
    explanation: null,
    submitted_at: '2026-10-08T10:00:00.000Z',
  },
  versions: [],
  settlement: null,
} as unknown as Prediction;

const pick = (props: Partial<Parameters<typeof InlinePick>[0]> = {}) =>
  renderToStaticMarkup(
    <InlinePick
      locale="en"
      fixture={{ id: FIXTURE, kickoff_at: TRACTOR.kickoff_at, home: 'Tractor', away: 'Esteghlal' }}
      me={ME}
      current={null}
      split={<span data-testid="split">split</span>}
      {...props}
    />,
  );

describe('InlinePick', () => {
  it('offers one "Make your pick" before the member starts, the split not on the page', () => {
    const html = pick();
    expect(html).toContain('data-pick="before"');
    expect(html).toContain('Make your pick');
    expect(html).not.toContain('data-testid="split"');
  });

  it('sends a guest to sign in from the same control', () => {
    const html = pick({ me: null });
    expect(html).toContain('data-pick="guest"');
    expect(html).toContain('href="/en/login"');
    expect(html).toContain('border-community');
  });

  it('shows the locked pick and the split after kick-off, or that there was none', () => {
    const past = {
      id: FIXTURE,
      kickoff_at: '2020-01-01T00:00:00Z',
      home: 'Tractor',
      away: 'Esteghlal',
    };
    const locked = pick({ fixture: past, current: PICK });
    expect(locked).toContain('data-pick="locked"');
    expect(locked).toContain('data-testid="split"');
    expect(pick({ fixture: past })).toContain('You did not predict this match before kick-off.');
    // A guest is not told they did not predict.
    expect(pick({ fixture: past, me: null })).not.toContain('You did not predict');
  });
});

const consensus = (sample: number): CommunityConsensusResponse =>
  ({
    data: {
      sample,
      crowd: { shares: { home: 0.5, draw: 0.3, away: 0.2 }, counts: { home: 5, draw: 3, away: 2 } },
    },
  }) as unknown as CommunityConsensusResponse;

describe('CommunityConsensusList on the Predictions page', () => {
  const entries: ConsensusListEntry[] = [{ fixture_id: FIXTURE, consensus: consensus(10) }];
  const names = new Map([[FIXTURE, { home: 'Tractor', away: 'Esteghlal' }]]);

  it('says how many have picked and nothing about what, until the reader picks', () => {
    const html = renderToStaticMarkup(
      <CommunityConsensusList
        entries={entries}
        fixtures={names}
        revealed={new Set()}
        locale="en"
      />,
    );
    expect(html).toContain('data-testid="consensus-list-hidden"');
    expect(html).toContain('10 members have picked.');
    expect(html).not.toMatch(/\d+(\.\d)?%/);
  });

  it('shows the spread once revealed', () => {
    const html = renderToStaticMarkup(
      <CommunityConsensusList
        entries={entries}
        fixtures={names}
        revealed={new Set([FIXTURE])}
        locale="en"
      />,
    );
    expect(html).toContain('data-testid="consensus-list-spread"');
    expect(html).toContain('50.0%');
  });
});

const REPORT = {
  overall: {
    points: [
      { period: '2026-08', matches: 40, rps: 0.201, uniform_rps: 0.231, coverage: 'available' },
      { period: '2026-09', matches: 44, rps: 0.188, uniform_rps: 0.229, coverage: 'available' },
      { period: '2026-10', matches: 9, rps: 0.21, uniform_rps: 0.226, coverage: 'limited' },
    ],
  },
} as unknown as PublicModelAccuracyResponse;

describe('ModelAccuracyRecent', () => {
  it('lists the latest months, newest first, with the guessing baseline and the full report', () => {
    const html = renderToStaticMarkup(<ModelAccuracyRecent locale="en" report={REPORT} />);
    const months = [...html.matchAll(/<time dateTime="(\d{4}-\d{2})"/g)].map((m) => m[1]);
    expect(months).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(html).toContain('0.188');
    expect(html).toContain('0.229');
    expect(html).toContain('href="/en/model-accuracy"');
  });

  it('says so when nothing is scored, or the service did not answer', () => {
    const empty = { overall: { points: [] } } as unknown as PublicModelAccuracyResponse;
    expect(renderToStaticMarkup(<ModelAccuracyRecent locale="en" report={empty} />)).toContain(
      'accuracy-not-supplied',
    );
    expect(renderToStaticMarkup(<ModelAccuracyRecent locale="en" report={null} />)).toContain(
      'accuracy-unreachable',
    );
  });
});

const SUMMARY = {
  version_number: 2,
  kind: 'early' as const,
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: '2026-10-08T09:30:00.000Z',
  status: 'available' as const,
  probabilities: { home: 0.46, draw: 0.34, away: 0.2 },
  unavailable_reason: null,
};
const EVALUATION = { rps: 0.126, actual: { home: 1, away: 1 } } as ForecastEvaluation;

const expected = (props: Partial<Parameters<typeof ModelExpected>[0]> = {}, locale = 'en') =>
  renderToStaticMarkup(
    <ModelExpected
      summary={SUMMARY}
      evaluation={EVALUATION}
      result={{ home: 1, away: 1 }}
      home="Tractor"
      away="Esteghlal"
      timeZone="UTC"
      locale={locale}
      {...props}
    />,
  );

describe('ModelExpected in a match report', () => {
  it('shows the pre-match forecast with its version and time, the result and the score, in the model lane', () => {
    const html = expected();
    expect(html).toContain('data-lane="model"');
    expect(html).toContain('What the model expected');
    expect(html).toContain('dixon-coles-elo<span>@</span>0.6.0');
    expect(html).toContain('08 Oct, 09:30 UTC');
    expect(html).toMatch(/Result: <bdi>Tractor<\/bdi> .*1.*–.*1.* <bdi>Esteghlal<\/bdi>\./);
    expect(html).toContain('Ranked probability score for this forecast: 0.126');
    expect(html).not.toMatch(/bg-(community|founder)/);
  });

  it('says what is missing: no forecast, no result, not yet scored, no answer', () => {
    expect(expected({ summary: null })).toContain(
      'The model had no forecast for this match before kick-off.',
    );
    expect(expected({ result: null, evaluation: null })).toContain(
      'No result has been recorded for this match yet.',
    );
    expect(expected({ evaluation: null })).toContain('has not been scored against the result yet');
    expect(expected({ summary: 'unreachable', evaluation: null })).toContain('could not be loaded');
  });

  it('is Persian on /fa, with Persian digits', () => {
    const html = expected({}, 'fa');
    expect(html).toContain('مدل چه انتظاری داشت');
    expect(html).toContain('۰٫۱۲۶');
  });
});
