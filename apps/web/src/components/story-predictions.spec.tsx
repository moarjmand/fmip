import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CardForecast } from '@/lib/score-card-products';
import {
  StoryPredictions,
  type StoryMatch,
  type StoryPredictionsAbout,
  forecastCoverage,
  storyPredictionsState,
} from './story-predictions';

/**
 * "Predictions for this match" on the story page (T-1741, D-362): the
 * model's bar in its own box with the way to the match page's pick card
 * when the story's match has a forecast and has not kicked off; the missing
 * forecast said when it has none; one line when the story links no match;
 * and the founder's analysis and the community consensus each a sentence of
 * its own, never a figure (rule 6).
 */

const FIXTURE = '00000000-0000-4000-8000-000000000901';
const KICKOFF = '2026-11-05T17:45:00.000Z';
const BEFORE = Date.parse('2026-11-05T09:00:00.000Z');
const AFTER = Date.parse('2026-11-05T18:00:00.000Z');
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

const MATCH: StoryMatch = {
  id: FIXTURE,
  kickoff_at: KICKOFF,
  status: 'scheduled',
  competition: {
    id: 'uel',
    name: 'UEFA Europa League',
    short_name: null,
    country_id: null,
  },
  home: {
    id: 'sparta',
    name: 'Sparta Prague',
    short_name: null,
    code: null,
    formation: null,
    coach: null,
  },
  away: {
    id: 'bournemouth',
    name: 'Bournemouth',
    short_name: null,
    code: null,
    formation: null,
    coach: null,
  },
};

const FORECAST: CardForecast = {
  state: 'available',
  home: 14.2,
  draw: 18.9,
  away: 66.9,
  version: 4,
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: '2026-11-02T00:10:00.000Z',
};

const about = (
  over: Partial<Extract<StoryPredictionsAbout, { state: 'match' }>> = {},
): StoryPredictionsAbout => ({
  state: 'match',
  match: MATCH,
  forecast: FORECAST,
  founder: 'none',
  community: 'below_floor',
  ...over,
});

const render = (a: StoryPredictionsAbout, now = BEFORE, locale = 'en') =>
  renderToStaticMarkup(
    <StoryPredictions about={a} locale={locale} timeZone="Europe/London" now={now} />,
  );

const text = (html: string) => html.replace(/<[^>]+>/g, '');

describe('which card a story gets', () => {
  it('is the full card only for a match with a forecast that has not kicked off', () => {
    expect(storyPredictionsState(about(), BEFORE)).toBe('forecast');
    expect(storyPredictionsState(about({ forecast: { state: 'none' } }), BEFORE)).toBe(
      'no_forecast',
    );
    expect(storyPredictionsState(about({ forecast: { state: 'unreachable' } }), BEFORE)).toBe(
      'no_forecast',
    );
    // Kick-off has passed, by the clock or by the match's own status.
    expect(storyPredictionsState(about(), AFTER)).toBe('started');
    expect(storyPredictionsState(about({ match: { ...MATCH, status: 'live' } }), BEFORE)).toBe(
      'started',
    );
    expect(storyPredictionsState(about({ match: { ...MATCH, status: 'finished' } }), BEFORE)).toBe(
      'started',
    );
    expect(storyPredictionsState({ state: 'no_match' }, BEFORE)).toBe('no_match');
    expect(storyPredictionsState({ state: 'unreachable', fixtureId: FIXTURE }, BEFORE)).toBe(
      'unreachable',
    );
  });

  it('says a missing forecast with the state that is true of it', () => {
    expect(forecastCoverage(FORECAST)).toBe('available');
    expect(forecastCoverage({ state: 'none' })).toBe('not_supplied');
    expect(
      forecastCoverage({ state: 'unavailable', reason: null, version: 1, computed_at: KICKOFF }),
    ).toBe('not_supplied');
    // The service did not answer: it may yet.
    expect(forecastCoverage({ state: 'unreachable' })).toBe('delayed');
  });
});

describe('a story about a match with a forecast', () => {
  const html = render(about());

  it('shows the two sides, the kick-off in the reader’s zone and the model’s bar in its box', () => {
    expect(html).toContain('data-state="forecast"');
    expect(html).toMatch(/<h2 id="story-predictions"[^>]*>Predictions for this match<\/h2>/);
    expect(text(html)).toContain('Sparta Prague');
    expect(text(html)).toContain('Bournemouth');
    // 17:45 UTC is 17:45 in London in November, and the zone is named.
    expect(html).toMatch(
      /data-testid="story-predictions-when".*UEFA Europa League.*Thu,? 5 Nov.*17:45.*UK time/,
    );
    // In Tehran the same kick-off is 21:15.
    const tehran = renderToStaticMarkup(
      <StoryPredictions about={about()} locale="en" timeZone="Asia/Tehran" now={BEFORE} />,
    );
    expect(tehran).toMatch(/data-testid="story-predictions-when".*21:15.*Tehran time/);
    // The model's figures, named, in the model's box, with the version label.
    const box = /data-testid="story-model".*?data-testid="story-pick"/s.exec(html)?.[0] ?? '';
    expect(box).toContain('data-testid="forecast-bar"');
    expect(text(box)).toContain('14.2%');
    expect(text(box)).toContain('18.9%');
    expect(text(box)).toContain('66.9%');
    expect(text(box)).toContain('dixon-coles-elo@0.6.0');
    expect(box).toContain('data-testid="forecast-bar-meta"');
  });

  it('leads to the match page’s pick card with one outlined button, and holds no pick buttons', () => {
    const pick = /<a[^>]*data-testid="story-pick"[^>]*>/.exec(html)?.[0] ?? '';
    expect(pick).toContain(`href="/en/match/${FIXTURE}#pick"`);
    expect(pick).toContain('border-accent');
    expect(pick).toContain('min-h-touch');
    expect(pick).not.toContain('bg-brand');
    expect(text(html)).toContain('Make your pick on the match page');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('aria-pressed');
  });

  it('names the founder’s analysis and the community each in its own sentence, as not yet', () => {
    expect(html).toMatch(/data-testid="story-product-analysis" data-state="none"/);
    expect(text(html)).toContain('The founder&#x27;s analysis: none published for this match yet.');
    expect(html).toMatch(/data-testid="story-product-community" data-state="below_floor"/);
    expect(text(html)).toContain(
      'The community consensus: not yet. It is shown once 5 members have picked.',
    );
    // Neither is a link while there is nothing to open.
    expect(html).not.toContain('#analysis');
    expect(html).not.toContain('#community');
  });

  it('links each to its own section once it exists, and still shows no figure of theirs', () => {
    const both = render(about({ founder: 'published', community: 'published' }));
    expect(both).toContain(`href="/en/match/${FIXTURE}#analysis"`);
    expect(both).toContain(`href="/en/match/${FIXTURE}#community"`);
    expect(text(both)).toContain(
      'The founder&#x27;s analysis: published. Read it on the match page',
    );
    expect(text(both)).toContain('The community consensus: published. See it on the match page');
    // The only percentages on the card are the model's three, inside its box.
    const outside = both.replace(/data-testid="story-model".*?data-testid="story-pick"/s, '');
    expect(outside).not.toMatch(/\d+(\.\d)?%/);
    // And says so when either could not be checked, rather than "none".
    const unknown = render(about({ founder: 'unreachable', community: 'unreachable' }));
    expect(text(unknown)).toContain('The founder&#x27;s analysis: cannot be checked right now.');
    expect(text(unknown)).toContain('The community consensus: cannot be checked right now.');
  });

  it('uses logical properties only, and reads in Persian with Persian digits', () => {
    expect(html).not.toMatch(PHYSICAL);
    const fa = render(about(), BEFORE, 'fa');
    expect(fa).not.toContain('data-translation="untranslated"');
    expect(text(fa)).toContain('پیش‌بینی‌های این بازی');
    expect(text(fa)).toContain('در صفحهٔ مسابقه انتخاب کنید');
    expect(text(fa)).toContain('پس از انتخاب ۵ عضو نشان داده می‌شود');
    expect(fa).toContain(`href="/fa/match/${FIXTURE}#pick"`);
  });
});

describe('a story about a match with no forecast', () => {
  it('says so in the model’s box with the coverage state, and keeps the way to the pick', () => {
    const html = render(about({ forecast: { state: 'none' } }));
    expect(html).toContain('data-state="no_forecast"');
    const box = /data-testid="story-model".*?data-testid="story-pick"/s.exec(html)?.[0] ?? '';
    expect(box).toContain('data-coverage-badge="not_supplied"');
    expect(text(box)).toContain('No model forecast for this match yet.');
    // No bar and no figure: nothing drawn as if it were there (rule 3).
    expect(html).not.toContain('data-segment=');
    expect(html).not.toMatch(/\d+(\.\d)?%/);
    expect(html).toContain(`href="/en/match/${FIXTURE}#pick"`);
  });

  it('says the service did not answer as delayed, never as no forecast', () => {
    const html = render(about({ forecast: { state: 'unreachable' } }));
    expect(html).toContain('data-coverage-badge="delayed"');
    expect(html).not.toContain('data-coverage-badge="not_supplied"');
  });
});

describe('a story with no upcoming match', () => {
  it('is one line with the coverage state when the story links no match', () => {
    const html = render({ state: 'no_match' });
    expect(html).toContain('data-state="no_match"');
    expect(html).toMatch(/data-testid="story-predictions-missing" data-coverage="not_supplied"/);
    expect(html).toContain('data-coverage-badge="not_supplied"');
    expect(text(html)).toContain('This story is not linked to an upcoming match');
    // No box, no bar, no button, no product line: one line and the heading.
    expect(html).not.toContain('data-testid="story-model"');
    expect(html).not.toContain('data-testid="story-pick"');
    expect(html).not.toContain('story-product-');
    expect(html.match(/<p /g)).toHaveLength(1);
  });

  it('closes the pick once the match has kicked off, and sends the reader to the match page', () => {
    for (const html of [
      render(about(), AFTER),
      render(about({ match: { ...MATCH, status: 'live' } })),
    ]) {
      expect(html).toContain('data-state="started"');
      expect(html).toContain('data-testid="story-predictions-started"');
      expect(text(html)).toContain('picks are closed');
      expect(html).not.toContain('data-testid="story-pick"');
      expect(html).not.toContain('#pick');
      expect(html).not.toContain('data-testid="story-model"');
      const link = /<a[^>]*data-testid="story-predictions-match"[^>]*>/.exec(html)?.[0] ?? '';
      expect(link).toContain(`href="/en/match/${FIXTURE}"`);
    }
  });

  it('says a match that could not be read as delayed, with the way to its page', () => {
    const html = render({ state: 'unreachable', fixtureId: FIXTURE });
    expect(html).toContain('data-state="unreachable"');
    expect(html).toMatch(/data-testid="story-predictions-missing" data-coverage="delayed"/);
    expect(html).toContain(`href="/en/match/${FIXTURE}"`);
    expect(html).not.toContain('data-testid="story-model"');
  });
});
