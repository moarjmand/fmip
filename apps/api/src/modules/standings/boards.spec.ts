import { describe, expect, it } from 'vitest';
import { cleanSheetsModule } from './standings.service';

const at = '2025-09-08T17:00:00.000Z';

describe('cleanSheetsModule (T-943)', () => {
  it('is not supplied when no side could be judged, whatever the season declares', () => {
    expect(
      cleanSheetsModule({ rows: [], sides: 20, judged: 0, lastUpdatedAt: at }, 'available'),
    ).toEqual({ coverage: 'not_supplied', last_updated_at: at, data: null });
    expect(
      cleanSheetsModule({ rows: [], sides: 20, judged: 0, lastUpdatedAt: at }, 'delayed').coverage,
    ).toBe('delayed');
  });

  it('takes the declared state when every side was judged', () => {
    expect(
      cleanSheetsModule({ rows: ['k'], sides: 4, judged: 4, lastUpdatedAt: at }, 'available'),
    ).toEqual({ coverage: 'available', last_updated_at: at, data: ['k'] });
  });

  it('is limited when some sides had no line-up naming a starting goalkeeper', () => {
    expect(
      cleanSheetsModule({ rows: ['k'], sides: 4, judged: 3, lastUpdatedAt: at }, 'available')
        .coverage,
    ).toBe('limited');
    // Undeclared line-ups are limited already.
    expect(
      cleanSheetsModule({ rows: ['k'], sides: 4, judged: 4, lastUpdatedAt: at }, null).coverage,
    ).toBe('limited');
  });

  it('keeps an empty list when sides were judged and nobody kept a clean sheet', () => {
    expect(
      cleanSheetsModule({ rows: [], sides: 2, judged: 2, lastUpdatedAt: at }, 'available'),
    ).toEqual({ coverage: 'available', last_updated_at: at, data: [] });
  });
});
