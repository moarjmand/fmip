import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RatingHistoryResponse } from '@fmip/contracts';
import type { ApiResult } from '@/lib/api';
import { accuracyLabel } from '@/lib/rating-history';
import { RatingHistorySection } from './rating-history';

/**
 * The rating over time in Persian (T-1306, D-175): the labels come from the
 * catalogue, the figures in Persian digits, and English stays word for word.
 */

const RESULT = {
  ok: true,
  status: 200,
  data: {
    kind: 'visible',
    username: 'sara',
    is_self: false,
    history: {
      formula_version: 'pr-1',
      settled_total: 12,
      points: [
        {
          date: '2026-01-01',
          settled_at: '2026-01-01T21:00:00.000Z',
          rating: 40,
          settled_total: 3,
          provisional: true,
        },
        {
          date: '2026-01-11',
          settled_at: '2026-01-11T21:00:00.000Z',
          rating: 55.5,
          settled_total: 12,
          provisional: false,
        },
      ],
      highest: {
        rating: 55.5,
        date: '2026-01-11',
        settled_at: '2026-01-11T21:00:00.000Z',
        provisional: false,
      },
      by_competition: [
        {
          competition: { id: 'c1', name: 'Persian Gulf Pro League' },
          settled_count: 12,
          outcome_correct: 7,
          score_correct: 2,
          rating: 55.5,
          provisional: false,
        },
      ],
      computed_at: '2026-01-11T22:00:00.000Z',
    },
  },
} as unknown as ApiResult<RatingHistoryResponse>;

describe('the rating over time, in Persian', () => {
  it('renders its labels and figures in Persian for fa', () => {
    const html = renderToStaticMarkup(
      <RatingHistorySection locale="fa" direction="rtl" result={RESULT} />,
    );
    expect(html).toContain('به تفکیک رقابت');
    expect(html).toContain('بالاترین:');
    expect(html).toContain('۵۵٫۵');
    expect(html).toContain('۷ درست از ۱۲ (۵۸٪)');
    expect(html).not.toContain('By competition');
    expect(html).not.toContain('data-translation="untranslated"');
  });

  it('keeps the English as it was', () => {
    const html = renderToStaticMarkup(
      <RatingHistorySection locale="en" direction="ltr" result={RESULT} />,
    );
    expect(html).toContain('By competition');
    expect(html).toContain('Highest: <span><span class="font-semibold tabular-nums">55.5</span>');
    expect(accuracyLabel({ settled_count: 12, outcome_correct: 7 }, 'en')).toBe(
      '7 of 12 correct (58%)',
    );
  });

  it('says a restricted history in Persian', () => {
    const html = renderToStaticMarkup(
      <RatingHistorySection
        locale="fa"
        direction="rtl"
        result={
          {
            ok: true,
            status: 200,
            data: { kind: 'restricted', username: 'sara', visibility: 'private' },
          } as unknown as ApiResult<RatingHistoryResponse>
        }
      />,
    );
    expect(html).toContain('روند امتیاز خصوصی است.');
  });
});
