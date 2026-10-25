import type { AuthUser, ForecastEvaluation, Prediction, ScoreCard } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prediction-actions', () => ({ submitPredictionAction: async () => null }));

const { ModelExpected } = await import('./forecast-panel');
const { InlinePick } = await import('./prediction-section');

/**
 * The pick and the match report in the Hybrid design (T-1383, D-201): the
 * pick control with the community's spread held back until the reader picks,
 * and "What the model expected" -- in English and in Persian, and with the
 * data missing. The old Predictions page's list, consensus list and recent
 * record went with the page (T-1519).
 */

const FIXTURE = '00000000-0000-4000-8000-000000000901';

const card = (id: string, kickoff: string, home: string, away: string): ScoreCard =>
  ({
    id,
    kickoff_at: kickoff,
    competition: { id: 'c1', name: 'Persian Gulf Pro League', short_name: null, country_id: null },
    home: { id: 'h', name: home },
    away: { id: 'a', name: away },
  }) as unknown as ScoreCard;

const TRACTOR = card(FIXTURE, '2099-10-08T13:30:00Z', 'Tractor', 'Esteghlal');
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
    expect(html).toContain('data-voice="model"');
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
