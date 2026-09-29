import type { CandidateRecord, CandidateRecordsResponse } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CandidateRecordsReport } from './candidate-records-report';

/**
 * The candidates' records in the console (T-1103), rendered: the count toward
 * the minimum, never a verdict below it; the pairs with the published version
 * per competition; the service's silence said. Logical properties (rule 7).
 */
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

function record(overrides: Partial<CandidateRecord>): CandidateRecord {
  return {
    model_version: 'dixon-coles-elo@0.5.0',
    in_shadow: true,
    pre_kickoff_evaluated: 120,
    pre_kickoff_awaiting: 8,
    after_kickoff: 2,
    unavailable: 1,
    competitions: [
      {
        competition: { id: 'c1', name: 'Premier League' },
        pairs: 110,
        published_versions: ['dixon-coles-elo@0.1.0'],
        candidate: { log_loss: 0.98765, brier: 0.5812 },
        published: { log_loss: 1.00123, brier: 0.5901 },
      },
    ],
    shadow: {
      first_answered_at: '2026-09-01T10:00:00Z',
      last_answered_at: '2026-09-30T10:00:00Z',
      day: { asked: 4, failed: 0 },
      last_failure: null,
    },
    ...overrides,
  };
}

function report(overrides: Partial<CandidateRecordsResponse>): CandidateRecordsResponse {
  return {
    minimum: 300,
    service: 'answered',
    candidates: [record({})],
    generated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

const html = (r: CandidateRecordsResponse) =>
  renderToStaticMarkup(<CandidateRecordsReport locale="en" report={r} />);

describe('CandidateRecordsReport (T-1103)', () => {
  it('says how many a candidate below the minimum has, and gives no verdict', () => {
    const out = html(report({}));
    expect(out).toContain('120 of 300');
    expect(out).toContain('this is a record, not a verdict');
    expect(out).not.toMatch(/\b(better|worse|passed|failed|promote it)\b/i);
    expect(out).toContain('0.9877');
    expect(out).toContain('1.0012');
    expect(out).toContain('dixon-coles-elo@0.1.0');
    expect(out).not.toMatch(PHYSICAL);
  });

  it('at the minimum sends promotion to a decision entry, not this page', () => {
    const out = html(report({ candidates: [record({ pre_kickoff_evaluated: 300 })] }));
    expect(out).toContain('The minimum is reached');
    expect(out).toContain('decision entry');
  });

  it('shows each candidate, one with no pairs yet, and the service silent', () => {
    const out = html(
      report({
        service: 'unreachable',
        candidates: [
          record({ in_shadow: null }),
          record({
            model_version: 'dixon-coles-elo@0.6.0',
            in_shadow: null,
            pre_kickoff_evaluated: 0,
            competitions: [],
          }),
        ],
      }),
    );
    expect(out).toContain('data-testid="candidates-service-unreachable"');
    expect(out.match(/data-testid="candidate-record"/g)).toHaveLength(2);
    expect(out).toContain('data-testid="candidate-no-pairs"');
    expect(out).toContain('0 of 300');
    expect(out).toContain('whether it still runs in shadow is not known');
  });

  it('says so when there is no candidate at all', () => {
    expect(html(report({ candidates: [] }))).toContain('data-testid="candidates-none"');
  });
});
