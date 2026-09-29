import type { CandidateRecord, CandidateRecordsResponse } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { conditionName } from '@/lib/system';
import { CandidatesSection } from './system-report';

/**
 * The candidates in shadow on the System page (T-1165), rendered: each with
 * its newest answer, the last 24 hours and its last failure; a candidate that
 * has never answered says so rather than showing zero; the service's silence
 * and the API's are said. Logical properties (rule 7).
 */
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;
const NOW = '2026-10-01T12:00:00Z';

function record(overrides: Partial<CandidateRecord>): CandidateRecord {
  return {
    model_version: 'dixon-coles-elo@0.5.0',
    in_shadow: true,
    pre_kickoff_evaluated: 120,
    pre_kickoff_awaiting: 8,
    after_kickoff: 2,
    unavailable: 1,
    competitions: [],
    shadow: {
      first_answered_at: '2026-09-01T10:00:00Z',
      last_answered_at: '2026-10-01T11:00:00Z',
      day: { asked: 6, failed: 1 },
      last_failure: { at: '2026-10-01T09:00:00Z', fixture_id: 'fx-1' },
    },
    ...overrides,
  };
}

const report = (overrides: Partial<CandidateRecordsResponse>): CandidateRecordsResponse => ({
  minimum: 300,
  service: 'answered',
  candidates: [record({})],
  generated_at: NOW,
  ...overrides,
});

const html = (r: CandidateRecordsResponse | null) =>
  renderToStaticMarkup(<CandidatesSection report={r} locale="en" />);

describe('CandidatesSection (T-1165)', () => {
  it('shows each candidate in shadow with its newest answer, its day and its last failure', () => {
    const out = html(report({}));
    expect(out).toContain('dixon-coles-elo@0.5.0');
    expect(out).toContain('1 h ago');
    expect(out).toContain('stored nothing for 1 of 6');
    expect(out).toContain('data-testid="system-candidate-failure"');
    expect(out).toContain('3 h ago');
    expect(out).toContain('fx-1');
    expect(out).toContain('forecast.shadow_failed');
    expect(out).toContain('href="/en/admin/model-candidates"');
    expect(out).not.toMatch(PHYSICAL);
  });

  it('says a candidate that has never answered, never zero failures', () => {
    const never = record({
      model_version: 'dixon-coles-elo@0.6.0',
      shadow: {
        first_answered_at: null,
        last_answered_at: null,
        day: { asked: 0, failed: 0 },
        last_failure: null,
      },
    });
    const out = html(report({ candidates: [never] }));
    expect(out).toContain('data-testid="system-candidate-never"');
    expect(out).toContain('Never answered');
    expect(out).not.toContain('0 of 0');
    expect(out).not.toContain('system-candidate-no-failure');
  });

  it('says no failure in the look-back and a day with nothing asked in words', () => {
    const quiet = record({
      shadow: {
        first_answered_at: '2026-09-01T10:00:00Z',
        last_answered_at: '2026-09-29T10:00:00Z',
        day: { asked: 0, failed: 0 },
        last_failure: null,
      },
    });
    const out = html(report({ candidates: [quiet] }));
    expect(out).toContain('not asked');
    expect(out).toContain('none in 7 days');
  });

  it('leaves out a candidate that left shadow, and says when none is in shadow', () => {
    const out = html(report({ candidates: [record({ in_shadow: false })] }));
    expect(out).not.toContain('system-candidate-table');
    expect(out).toContain('No candidate is in shadow');
  });

  it("says the model service's silence and the API's, never as nothing wrong", () => {
    const silent = html(
      report({ service: 'unreachable', candidates: [record({ in_shadow: null })] }),
    );
    expect(silent).toContain('data-testid="system-candidates-silent"');
    expect(silent).toContain('in shadow: not known');
    expect(html(null)).toContain('data-testid="system-candidates-unavailable"');
  });

  it("names the watchdog's candidate condition", () => {
    expect(conditionName('candidate:dixon-coles-elo@0.5.0')).toBe(
      'Candidate in shadow: dixon-coles-elo@0.5.0',
    );
  });
});
