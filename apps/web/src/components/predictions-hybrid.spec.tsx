import type { ForecastEvaluation } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModelExpected } from './forecast-panel';

/**
 * The match report in the Hybrid design (T-1383, D-201): "What the model
 * expected" -- in English and in Persian, and with the data missing. The old
 * Predictions page's list, consensus list and recent record went with the
 * page (T-1519); the row's pick control became `PickControl` (T-1738), whose
 * states are `pick-control.spec.tsx`'s.
 */

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

  it('states no result, winner or score for stored scores that contradict each other (T-1819, D-414)', () => {
    // An evaluation handed in anyway still holds the 4-0 it was scored against.
    const html = expected({
      result: null,
      evaluation: { rps: 0.2, actual: { home: 4, away: 0 } } as ForecastEvaluation,
      scoreUnclear: true,
    });
    expect(html).toContain('Score unclear in the source');
    expect(html).not.toContain('No result has been recorded');
    expect(html).not.toContain('data-testid="story-model-rps"');
    expect(html.replace(/<[^>]+>/g, '')).not.toMatch(/4\s*–\s*0/);
  });

  it('is Persian on /fa, with Persian digits', () => {
    const html = expected({}, 'fa');
    expect(html).toContain('مدل چه انتظاری داشت');
    expect(html).toContain('۰٫۱۲۶');
  });
});
