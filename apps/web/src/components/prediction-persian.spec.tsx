import type { FounderAnalysisResponse, Prediction } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommunityAnalysisPanel } from './community-analysis-panel';
import { FounderAnalysisPanel } from './founder-analysis';
import { emptyBoardSentence, monthLabel, ratingLabel, tierLabel } from '@/lib/leaderboard';
import { settlementLabel } from '@/lib/prediction-history';

/**
 * The prediction surfaces in Persian (T-1307, D-175): the words come from the
 * catalogue, the digits are Persian, and the three prediction products keep
 * their own names. English reads exactly as it did.
 */

const ANALYSIS = {
  analysis: {
    author: { display_name: 'The Founder' },
    versions: [
      {
        id: 'v2',
        version_number: 2,
        predicted_outcome: 'home',
        predicted_score: { home: 2, away: 1 },
        confidence: 4,
        reasoning: 'Reasoning.',
        lineup_impact: null,
        key_players: 'Players.',
        form_and_context: null,
        published_at: '2026-09-29T08:00:00.000Z',
      },
      {
        id: 'v1',
        version_number: 1,
        predicted_outcome: 'draw',
        predicted_score: null,
        confidence: 3,
        reasoning: 'Earlier.',
        lineup_impact: null,
        key_players: null,
        form_and_context: null,
        published_at: '2026-09-28T08:00:00.000Z',
      },
    ],
  },
} as unknown as FounderAnalysisResponse;

const founder = (locale: string) =>
  renderToStaticMarkup(
    <FounderAnalysisPanel
      analysis={ANALYSIS}
      home="Test Home"
      away="Test Away"
      timeZone="UTC"
      locale={locale}
    />,
  );

describe('the prediction surfaces in Persian (T-1307)', () => {
  it("names the founder's analysis as itself, with Persian digits and no English standing in", () => {
    const html = founder('fa');
    expect(html).toContain('تحلیل بنیان‌گذار');
    expect(html).toContain('نه مدل آماری است و نه نظر جمعی کاربران');
    expect(html).toContain('برد Test Home');
    expect(html).toContain('۲–۱');
    expect(html).toContain('اطمینان ۴/۵');
    expect(html).toContain('بازیکنان کلیدی و نبردهای تن‌به‌تن');
    expect(html).toContain('۲ نسخه — آنچه پیش‌تر گفته شده بود');
    expect(html).not.toContain('data-translation="untranslated"');
    expect(html).not.toMatch(/confidence|Written by/);
  });

  it('reads in English exactly as before', () => {
    const html = founder('en');
    expect(html).toContain('Founder’s analysis');
    expect(html).toContain('Test Home win');
    // A home–away pair in the page's direction (T-1378): left to right in English.
    expect(html).toContain(
      '<span dir="ltr" class="[unicode-bidi:isolate]" data-testid="founder-score">2–1</span>',
    );
    expect(html).toContain('· confidence 4/5');
    expect(html).toContain('Written by The Founder · published');
    expect(html).toContain('2026-09-29 08:00');
    expect(html).toContain(' · updated, version 2');
    expect(html).toContain('2 versions — what was said before');
  });

  it("names the contributors' panel apart from the other three, in Persian", () => {
    const html = renderToStaticMarkup(
      <CommunityAnalysisPanel locale="fa" analyses={{ analyses: [] } as never} reachable />,
    );
    expect(html).toContain('تحلیل تحلیلگران تأییدشده');
    expect(html).toContain('نه تحلیل بنیان‌گذار است، نه مدل آماری و نه نظر جمعی کاربران');
    expect(html).toContain('هیچ تحلیلگری تحلیلی از این بازی منتشر نکرده است.');
  });

  it('says the board and its tiers in Persian, with a Gregorian month', () => {
    expect(tierLabel('gold', 'fa')).toBe('طلایی');
    expect(ratingLabel({ rating: 72 }, 'fa')).toBe('۷۲٫۰');
    expect(ratingLabel({ rating: 72 })).toBe('72.0');
    const month = monthLabel('2026-09', 'fa');
    expect(month).toContain('سپتامبر');
    expect(month).toContain('۲۰۲۶');
    expect(emptyBoardSentence('everyone', { kind: 'all' }, 30, false, 'fa')).toBe(
      'هنوز هیچ عضوی ۳۰ پیش‌بینی تسویه‌شده ندارد.',
    );
  });

  it('says how a prediction settled in Persian', () => {
    const open = { settlement: null, locked: false } as unknown as Prediction;
    expect(settlementLabel(open, 'fa')).toEqual({ text: 'تا شروع بازی باز است', tone: 'open' });
    expect(settlementLabel(open)).toEqual({ text: 'Open until kick-off', tone: 'open' });
  });
});
