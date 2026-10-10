import type { ScoreCard as ScoreCardData } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScoreCard } from './score-card';
import { t } from '@/i18n/messages';
import { scoresWords } from '@/lib/words-server';

/**
 * The provider's stage and round on a score card, in the reader's words
 * (T-1339): Persian on /fa, exactly the provider's English on /en.
 */
const card: ScoreCardData = {
  id: '00000000-0000-4000-8000-000000001339',
  kickoff_at: '2026-09-05T18:45:00.000Z',
  status: 'scheduled',
  minute: null,
  competition: { id: 'c', name: 'UEFA Nations League', short_name: null, country_id: null },
  season: { id: 's', label: '2026/27' },
  stage: { id: 'st', name: 'League A', kind: 'group' },
  round: 'League A - 1',
  leg: null,
  home: { id: 'h', name: 'Test Alpha', short_name: null, code: 'ALP' },
  away: { id: 'a', name: 'Test Beta', short_name: null, code: 'BET' },
  scores: {
    current: null,
    half_time: null,
    full_time: null,
    extra_time: null,
    penalties: null,
    aggregate: null,
  },
  red_cards: { home: 0, away: 0 },
  incidents: [],
  venue: null,
  coverage: 'available',
  last_updated_at: '2026-09-05T12:00:00.000Z',
  freshness: null,
  pinned: false,
};

const render = (locale: 'en' | 'fa', over: Partial<ScoreCardData> = {}): string =>
  renderToStaticMarkup(
    <ul>
      <ScoreCard
        words={scoresWords(locale)}
        card={{ ...card, ...over }}
        timeZone="UTC"
        locale={locale}
      />
    </ul>,
  );

describe('a score card names the stage and round in the reader’s words', () => {
  it('says them in Persian on /fa', () => {
    const html = render('fa');
    expect(html).toContain('<span>لیگ A، هفته‌ی ۱</span>');
    // Once (T-1343): the round already names the stage.
    expect(html).not.toContain('<span>لیگ A</span>');
    expect(html.split('لیگ A').length - 1).toBe(1);
    expect(html).not.toContain('League A');
    const league = render('fa', {
      stage: { id: 'st', name: 'Regular Season', kind: 'league' },
      round: 'Regular Season - 12',
    });
    expect(league).toContain('<span>هفته‌ی ۱۲</span>');
    expect(league).not.toContain('Regular Season');
    expect(league).not.toContain(t('fa', 'stage.name.regularSeason'));
  });

  it('keeps a stage the round does not name', () => {
    const html = render('fa', {
      stage: { id: 'st', name: 'Group Stage', kind: 'group' },
      round: 'Group A - 2',
    });
    expect(html).toContain(`<span>${t('fa', 'stage.name.groupStage')}</span>`);
  });

  it('never prints a provider label it cannot name (T-1375)', () => {
    const friendly = { stage: null, round: 'Friendly International' };
    expect(render('fa', friendly)).toContain(`<span>${t('fa', 'stage.name.friendly')}</span>`);
    expect(render('fa', friendly)).not.toContain('Friendly International');
    expect(render('en', friendly)).not.toContain('Friendly International');
    const unknown = { stage: null, round: 'Mystery Phase' };
    expect(render('fa', unknown)).not.toContain('Mystery Phase');
    expect(render('en', unknown)).not.toContain('Mystery Phase');
    const numbered = { stage: null, round: 'Mystery Phase - 3' };
    expect(render('fa', numbered)).toContain('<span>دور ۳</span>');
    expect(render('fa', numbered)).not.toContain('Mystery');
  });

  it('keeps the provider’s English on /en', () => {
    const html = render('en');
    expect(html).toContain('<span>League A - 1</span>');
    expect(html).not.toContain('<span>League A</span>');
  });
});
