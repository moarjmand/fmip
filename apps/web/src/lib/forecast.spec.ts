import type { ForecastVersion } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { describeChange, favourite, framing, percentages, versionChanges } from './forecast';

const version = (n: number, p: [number, number, number] | null, kind: ForecastVersion['kind']) =>
  ({
    id: `v${n}`,
    fixture_id: 'f',
    version_number: n,
    kind,
    model_version: p === null ? 'none@0.0.0' : 'dixon-coles-elo@0.1.0',
    computed_at: `2025-01-0${n}T12:00:00.000Z`,
    status: p === null ? 'unavailable' : 'available',
    probabilities: p === null ? null : { home: p[0], draw: p[1], away: p[2] },
    expected_goals: p === null ? null : { home: 1.5, away: 1.1 },
    most_likely_scorelines: p === null ? null : [{ home: 1, away: 1, probability: 0.12 }],
    leading_factors: p === null ? null : [],
    data_completeness: p === null ? null : 'limited',
    unavailable_reason: p === null ? 'no_history' : null,
    unavailable_detail: p === null ? 'scripted' : null,
  }) satisfies ForecastVersion;

describe('percentages', () => {
  it('totals exactly 100.0 after rounding to one decimal', () => {
    const p = percentages({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 });
    expect(p).toEqual({ home: 33.4, draw: 33.3, away: 33.3 });
    expect(Math.round((p.home + p.draw + p.away) * 10)).toBe(1000);
    expect(percentages({ home: 0.4637, draw: 0.2622, away: 0.2741 })).toEqual({
      home: 46.4,
      draw: 26.2,
      away: 27.4,
    });
  });
});

describe('framing', () => {
  it('names the favourite and the margin without asserting a result', () => {
    const clear = framing({ home: 0.7338, draw: 0.1866, away: 0.0796 }, 'Liverpool', 'Man United');
    expect(clear).toContain('gives Liverpool the most probability, 54.7 points ahead');
    expect(clear).toContain('not a prediction of the result');
    expect(clear).not.toMatch(/will win/i);
    const close = framing({ home: 0.36, draw: 0.3, away: 0.34 }, 'A', 'B');
    expect(close).toContain('close');
    expect(favourite({ home: 0.2, draw: 0.5, away: 0.3 })).toEqual({ outcome: 'draw', margin: 20 });
  });
});

describe('versionChanges', () => {
  it('compares each available version with the previous available one and skips unavailable ones', () => {
    const changes = versionChanges([
      version(1, [0.5, 0.25, 0.25], 'early'),
      version(2, null, 'lineups_predicted'),
      version(3, [0.46, 0.27, 0.27], 'lineups_confirmed'),
    ]);
    expect(changes.map((c) => c.delta)).toEqual([null, null, { home: -4, draw: 2, away: 2 }]);
    expect(describeChange(changes[2]!, 'Liverpool', 'Man United')).toBe(
      'Liverpool -4.0, draw +2.0, Man United +2.0 points (confirmed line-ups).',
    );
    expect(describeChange(changes[0]!, 'Liverpool', 'Man United')).toBeNull();
    const same = versionChanges([
      version(1, [0.5, 0.25, 0.25], 'early'),
      version(2, [0.5, 0.25, 0.25], 'manual'),
    ]);
    expect(describeChange(same[1]!, 'A', 'B')).toBe(
      'No change in probabilities (manual recomputation).',
    );
  });
});
