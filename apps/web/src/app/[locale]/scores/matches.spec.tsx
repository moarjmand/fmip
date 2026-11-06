import type {
  AuthUser,
  FounderAnalysisSummary,
  Prediction,
  ScoreCard as ScoreCardData,
  ScoresResponse,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardDetails, ScoreCard, rowPick } from '@/components/score-card';
import { LiveScores } from '@/components/live-scores';
import { RowForecast } from '@/components/score-card-forecast';
import type { CardForecast } from '@/lib/score-card-products';
import {
  pageHref,
  predictionsRedirect,
  readScoresQuery,
  scoresView,
  viewFlags,
} from '@/lib/scores';
import { isOpenForPick, NO_FILTERS, onlyUnpicked } from '@/lib/scores-filters';
import { forecastBarWords, scoresWords } from '@/lib/words-server';
import { MatchPreview } from './match-preview';
import { MatchesAnalysis } from './matches-analysis';

/**
 * Matches and predictions on one page (T-1496, D-268): the row's model cell,
 * its Pick in each state, the "Not picked yet" view, the addresses the page
 * is driven by, and the preview's rule that the community's split appears
 * only once the reader has picked (D-206).
 */

const NOW = Date.parse('2026-10-25T12:00:00Z');
const ID = '00000000-0000-4000-8000-000000001496';

const card = (over: Partial<ScoreCardData> = {}): ScoreCardData => ({
  id: ID,
  kickoff_at: '2026-10-25T19:00:00.000Z',
  status: 'scheduled',
  minute: null,
  competition: { id: 'c', name: 'La Liga', short_name: null, country_id: 'es' },
  season: { id: 's', label: '2026/27' },
  stage: null,
  round: null,
  leg: null,
  home: { id: 'h', name: 'Barcelona', short_name: null, code: 'BAR' },
  away: { id: 'a', name: 'Real Madrid', short_name: null, code: 'RMA' },
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
  last_updated_at: '2026-10-25T11:59:00.000Z',
  freshness: null,
  pinned: false,
  ...over,
});

const AVAILABLE: CardForecast = {
  state: 'available',
  home: 59.1,
  draw: 19.7,
  away: 21.2,
  version: 2,
  model_version: 'poisson-v1@2026-10-01',
  computed_at: '2026-10-25T08:00:00.000Z',
};

const row = (
  locale: 'en' | 'fa',
  props: Partial<Parameters<typeof ScoreCard>[0]> = {},
  over: Partial<ScoreCardData> = {},
): string =>
  renderToStaticMarkup(
    <ul>
      <ScoreCard
        card={card(over)}
        timeZone="UTC"
        locale={locale}
        now={NOW}
        forecast={AVAILABLE}
        pickHref={`/${locale}/scores?pick=${ID}#m-${ID}`}
        words={scoresWords(locale)}
        {...props}
      />
    </ul>,
  );

describe("the row's model cell", () => {
  const cell = (forecast: CardForecast | undefined, locale: 'en' | 'fa' = 'en'): string =>
    renderToStaticMarkup(
      <RowForecast
        forecast={forecast}
        home="Barcelona"
        away="Real Madrid"
        locale={locale}
        words={scoresWords(locale)}
      />,
    );

  /** The three figures the cell writes, in the order it writes them. */
  const figures = (html: string) =>
    [...html.matchAll(/<span dir="ltr">([^<]+)<\/span>/g)].map((m) => m[1]);

  it('draws the three percentages, home first, each on its segment of the one bar', () => {
    const html = cell(AVAILABLE);
    expect(html).toContain('data-state="available"');
    // The one `ForecastBar` at row size (T-1748, D-368): 8px at every width.
    expect(html).toContain('data-testid="row-bar"');
    expect(html).toContain('data-size="row"');
    expect(html).toContain('h-2');
    expect(html).not.toMatch(/h-1\.5|sm:h-2/);
    expect(figures(html)).toEqual(['59%', '20%', '21%']);
    expect(html).toContain('aria-label="Model forecast: Barcelona 59.1%');
    expect(html.match(/data-outcome=/g)).toHaveLength(3);
    // Each label cell grows by its segment's share: none is spread evenly.
    expect(html).not.toContain('justify-between');
    expect(html.match(/flex-grow:59\.1;flex-basis:0/g)).toHaveLength(2);
    // Before full time nothing is marked.
    expect(html).not.toContain('data-happened');
  });

  it('writes them in Persian digits on /fa', () => {
    expect(figures(cell(AVAILABLE, 'fa'))).toEqual(['۵۹٪', '۲۰٪', '۲۱٪']);
  });

  it('marks what happened on a finished row: an outline, a tick, and the word for a screen reader (T-1749)', () => {
    const html = renderToStaticMarkup(
      <RowForecast
        forecast={{ ...AVAILABLE, home: 67, draw: 19, away: 14 }}
        home="AC Milan"
        away="Ferencváros"
        outcome="away"
        locale="en"
        words={scoresWords('en')}
      />,
    );
    expect(html).toMatch(
      /data-segment="away" data-step="3" data-happened="" class="[^"]*outline-2 outline-offset-1 outline-fg/,
    );
    expect(html.match(/data-icon="check"/g)).toHaveLength(1);
    expect(html).toContain(
      'aria-label="Model forecast: AC Milan 67.0%, draw 19.0%, Ferencváros 14.0% (happened)"',
    );
    expect(html).not.toMatch(/bg-accent|bg-brand|text-accent/);
    // The word is not written on a row.
    expect(html.replace(/<[^>]*>/g, '')).not.toContain('happened');
  });

  it('takes the outcome from the ninety minutes of a finished card, and from nothing else', () => {
    const finished = (scores: Partial<ScoreCardData['scores']>) =>
      row('en', {}, { status: 'finished', scores: { ...card().scores, ...scores } });
    const lost = finished({ current: { home: 0, away: 2 }, full_time: { home: 0, away: 2 } });
    expect(lost).toMatch(/data-segment="away"[^>]*data-happened=""/);
    expect(lost.match(/data-segment="\w+"[^>]*data-happened=""/g)).toHaveLength(1);
    // Level after ninety minutes and won in extra time: what the model
    // forecast is the ninety minutes, so the draw is what happened.
    const extra = finished({
      current: { home: 2, away: 1 },
      full_time: { home: 1, away: 1 },
      extra_time: { home: 1, away: 0 },
    });
    expect(extra).toMatch(/data-segment="draw"[^>]*data-happened=""/);
    // A match to come and one in play mark nothing.
    expect(row('en')).not.toContain('data-happened');
    expect(
      row(
        'en',
        {},
        { status: 'live', minute: 70, scores: { ...card().scores, current: { home: 1, away: 0 } } },
      ),
    ).not.toContain('data-happened');
  });

  it('gives three whole numbers totalling 100, as blueprint 6.2 asks (T-1545)', () => {
    // Toulouse v Troyes on 25 Oct 2026 read 67 · 20 · 14 with each rounded alone;
    // the largest share absorbs the gap (`wholePercentages`, T-1555).
    const html = cell({ ...AVAILABLE, home: 66.6, draw: 19.6, away: 13.8 });
    expect(figures(html)).toEqual(['66%', '20%', '14%']);
    // The bar and its name keep the stored shares.
    expect(html).toContain('flex-grow:66.6');
    expect(html).toContain('Barcelona 66.6%');
  });

  it('says "Not supplied" for a match with no forecast, never an empty bar (rule 3)', () => {
    for (const forecast of [
      { state: 'none' },
      { state: 'unavailable', reason: 'no_history', version: 1, computed_at: NOW.toString() },
    ] as CardForecast[]) {
      const html = cell(forecast);
      expect(html).toContain('data-coverage-badge="not_supplied"');
      expect(html).toContain('not supplied');
      expect(html).not.toContain('data-outcome');
    }
    expect(cell({ state: 'none' }, 'fa')).toContain('data-coverage-badge="not_supplied"');
  });

  it('says a batch that did not answer was not loaded, not that nothing exists', () => {
    for (const forecast of [{ state: 'unreachable' } as CardForecast, undefined]) {
      const html = cell(forecast);
      expect(html).toContain('Not loaded');
      expect(html).not.toContain('data-coverage-badge');
    }
  });
});

describe("the row's Pick", () => {
  it('is open before kick-off, picked once the reader has picked, locked after', () => {
    expect(rowPick(card(), false, NOW)).toBe('open');
    expect(rowPick(card(), true, NOW)).toBe('picked');
    const started = card({ status: 'live', kickoff_at: '2026-10-25T11:00:00.000Z' });
    expect(rowPick(started, false, NOW)).toBe('locked');
    expect(rowPick(started, true, NOW)).toBe('locked-picked');
    // Kick-off time passed without a status change yet: still locked (D-206).
    expect(rowPick(card({ kickoff_at: '2026-10-25T11:00:00.000Z' }), false, NOW)).toBe('locked');
  });

  it('links to this page with the match preview open, named for the match', () => {
    const html = row('en');
    // To the row's own anchor (T-1738): the sheet opens and the list stays put.
    expect(html).toContain(`href="/en/scores?pick=${ID}#m-${ID}"`);
    expect(html).toContain(`<li id="m-${ID}"`);
    expect(html).toContain('data-pick="open"');
    expect(html).toContain('aria-label="Pick: Barcelona v Real Madrid"');
    expect(html).toContain('>Pick<');
  });

  it('says Picked once there is a pick, and View after kick-off without one', () => {
    expect(row('en', { picked: true })).toContain('>Picked<');
    const live = row('en', {}, { status: 'live', kickoff_at: '2026-10-25T11:00:00.000Z' });
    expect(live).toContain('data-pick="locked"');
    expect(live).toContain('>View<');
  });

  it('marks the previewed row, and has no Pick where the page gives none', () => {
    expect(row('en', { selected: true })).toContain('aria-current="true"');
    expect(row('en', { pickHref: undefined })).not.toContain('data-testid="row-pick"');
  });

  it('draws the previewed row on the solid selected ground, never a saffron wash (T-1535)', () => {
    // A 10% wash put the model's percentages under 4.5:1 on Day; the token is
    // checked against every text role in tokens.spec.ts.
    const html = row('en', { selected: true });
    expect(html).toContain('data-selected:bg-selected');
    expect(html).not.toMatch(/bg-accent\/\d+/);
  });

  it('is in Persian on /fa', () => {
    const html = row('fa');
    expect(html).toContain('>انتخاب<');
    expect(html).toContain('href="/fa/scores?pick=');
  });
});

describe('the row on a phone (T-1545)', () => {
  it('puts the model under the teams below 640 px, so a name keeps its width', () => {
    const html = row('en');
    expect(html).toContain('grid-cols-[2.75rem_minmax(0,1fr)_auto]');
    expect(html).toMatch(/max-sm:col-start-2 max-sm:row-start-2[^"]*" data-testid="row-forecast"/);
    expect(html).toMatch(
      /max-sm:col-start-3 max-sm:row-span-2 max-sm:row-start-1[^"]*" data-testid="row-pick"/,
    );
    // From 640 px the four columns of the Design System's row stand as they were.
    expect(html).toContain('sm:grid-cols-[3.25rem_minmax(0,1fr)_13rem_4.5rem]');
  });
});

describe('the stacked teams', () => {
  it('put each side its own goals once the match has started, none before', () => {
    expect(row('en')).not.toContain('data-testid="home-score"');
    const live = row(
      'en',
      {},
      {
        status: 'live',
        minute: 63,
        kickoff_at: '2026-10-25T11:00:00.000Z',
        scores: { ...card().scores, current: { home: 2, away: 1 } },
      },
    );
    expect(live).toMatch(/data-testid="home-team".*Barcelona.*data-testid="home-score"[^>]*>2</);
    expect(live).toMatch(/data-testid="away-team".*Real Madrid.*data-testid="away-score"[^>]*>1</);
  });

  it('writes the goals in Persian digits on /fa', () => {
    const html = row(
      'fa',
      {},
      {
        status: 'finished',
        kickoff_at: '2026-10-25T09:00:00.000Z',
        scores: {
          ...card().scores,
          current: { home: 3, away: 0 },
          full_time: { home: 3, away: 0 },
        },
      },
    );
    expect(html).toMatch(/data-testid="home-score"[^>]*>۳</);
    expect(html).toMatch(/data-testid="away-score"[^>]*>۰</);
  });
});

describe('the four views', () => {
  it('are one at a time, each its own address', () => {
    const q = readScoresQuery({ unpicked: '1' }, 'UTC', new Date(NOW));
    expect(scoresView(q)).toBe('unpicked');
    expect(scoresView(readScoresQuery({ favourites: '1' }, 'UTC', new Date(NOW)))).toBe('mine');
    expect(scoresView(readScoresQuery({ live: '1' }, 'UTC', new Date(NOW)))).toBe('live');
    expect(scoresView(readScoresQuery({}, 'UTC', new Date(NOW)))).toBe('all');
    expect(pageHref('en', q, viewFlags('live'))).toBe('/en/scores?live=1');
    expect(pageHref('en', q, viewFlags('all'))).toBe('/en/scores');
    expect(pageHref('en', q)).toBe('/en/scores?unpicked=1');
  });

  it('keep an open preview only when asked, and refuse a pick that is not a match id', () => {
    const q = readScoresQuery({ pick: ID.toUpperCase(), date: '2026-10-26' }, 'UTC', new Date(NOW));
    expect(q.pick).toBe(ID);
    expect(pageHref('en', q)).toBe('/en/scores?date=2026-10-26');
    expect(pageHref('en', q, { pick: ID })).toBe(`/en/scores?date=2026-10-26&pick=${ID}`);
    expect(readScoresQuery({ pick: '../admin' }, 'UTC').pick).toBeNull();
  });

  it('"Not picked yet" keeps only the matches still open that the reader has not picked', () => {
    const open = card({ id: 'open' });
    const picked = card({ id: 'picked' });
    const started = card({ id: 'started', status: 'live', kickoff_at: '2026-10-25T11:00:00Z' });
    const due = card({ id: 'due', kickoff_at: '2026-10-25T11:59:00Z' });
    const res: ScoresResponse = {
      date: '2026-10-25',
      timezone: 'UTC',
      generated_at: '2026-10-25T12:00:00Z',
      total: 5,
      pinned: [card({ id: 'pinned-picked', pinned: true })],
      groups: [
        {
          competition: { id: 'c', name: 'La Liga', logo: null } as never,
          country: null,
          fixtures: [open, picked, started, due],
        },
      ],
    } as unknown as ScoresResponse;
    const shown = onlyUnpicked(res, new Set(['picked', 'pinned-picked']), NOW);
    expect(shown.pinned).toEqual([]);
    expect(shown.groups[0]?.fixtures.map((c) => c.id)).toEqual(['open']);
    expect(shown.total).toBe(1);
    expect(isOpenForPick(due, NOW)).toBe(false);
    // A group left with nothing is dropped, not shown as an empty card.
    expect(onlyUnpicked(res, new Set(['open', 'picked']), NOW).groups).toEqual([]);
  });
});

describe('an old /predictions address', () => {
  it('leads to the matches page with its day, zone and competition', () => {
    expect(predictionsRedirect('en', {})).toBe('/en/scores');
    expect(
      predictionsRedirect('fa', {
        date: '2026-10-26',
        tz: 'Asia/Tehran',
        competition: 'c1',
        other: 'x',
      }),
    ).toBe('/fa/scores?date=2026-10-26&tz=Asia%2FTehran&competition=c1');
  });
});

describe('the founder’s analysis under the list (T-1519)', () => {
  const analysis = (analyses: FounderAnalysisSummary[] | null, locale = 'en'): string =>
    renderToStaticMarkup(<MatchesAnalysis locale={locale} timeZone="UTC" analyses={analyses} />);
  const ONE: FounderAnalysisSummary = {
    fixture: {
      id: ID,
      kickoff_at: '2026-10-25T19:00:00.000Z',
      status: 'scheduled',
      competition: { id: 'c', name: 'La Liga' },
      home: { id: 'h', name: 'Sevilla' },
      away: { id: 'a', name: 'Betis' },
    },
    author: { id: 'f', display_name: 'The founder' },
    predicted_outcome: 'home',
    predicted_score: { home: 2, away: 1 },
    confidence: 3,
    excerpt: 'Sevilla at home.',
    published_at: '2026-10-24T09:00:00.000Z',
    version_number: 1,
  };

  it('stands at #analysis in the founder’s voice alone, with the league and the model’s record', () => {
    const html = analysis([ONE]);
    expect(html).toContain('id="analysis"');
    expect(html.match(/data-voice="[a-z]+"/g)).toEqual(['data-voice="founder"']);
    expect(html).toContain('data-testid="founder-feed"');
    expect(html).toContain(`href="/en/match/${ID}"`);
    expect(html).toContain('href="/en/leaderboard"');
    expect(html).toContain('href="/en/model-accuracy"');
  });

  it('says when nothing is written, or the service did not answer (rule 3)', () => {
    expect(analysis([])).toContain('has not published an analysis recently');
    expect(analysis([])).not.toContain('founder-feed');
    expect(analysis(null)).toContain('unreachable right now');
    expect(analysis(null, 'fa')).toContain('href="/fa/leaderboard"');
  });
});

describe("the preview's details", () => {
  const details = (revealed: boolean): string =>
    renderToStaticMarkup(
      <CardDetails
        card={card()}
        timeZone="UTC"
        locale="en"
        now={NOW}
        forecast={AVAILABLE}
        community={{ state: 'available', sample: 9, home: 6, draw: 2, away: 1 }}
        revealed={revealed}
        words={scoresWords('en')}
      />,
    );

  it('keep the community line sealed until the reader picks (D-206)', () => {
    const sealed = details(false);
    expect(sealed).toContain('data-state="sealed"');
    expect(sealed).not.toMatch(/9 predictions|from 9/);
    expect(details(true)).not.toContain('data-state="sealed"');
  });
});

describe('the preview', () => {
  const member: AuthUser = {
    id: 'u',
    email: 'a@example.test',
    email_verified: true,
    username: 'reader',
  } as unknown as AuthUser;
  const pick: Prediction = {
    fixture_id: ID,
    locked: false,
    latest: {
      version_number: 1,
      outcome: 'home',
      score: null,
      confidence: 3,
      reason_tags: [],
      explanation: null,
      submitted_at: '2026-10-25T10:00:00.000Z',
    },
    versions: [],
  } as unknown as Prediction;
  const preview = (
    me: AuthUser | null,
    current: Prediction | null,
    forecast: CardForecast = AVAILABLE,
    locale: 'en' | 'fa' = 'en',
    over: Partial<ScoreCardData> = {},
  ): string =>
    renderToStaticMarkup(
      <MatchPreview
        card={card({ kickoff_at: new Date(Date.now() + 86_400_000).toISOString(), ...over })}
        now={Date.now()}
        locale={locale}
        timeZone="UTC"
        zone="UTC"
        me={me}
        current={current}
        consensus={{ coverage: 'available', data: null } as never}
        forecast={forecast}
        community={{ state: 'below_floor' }}
        viewing={{ state: 'ask' }}
        closeHref="/en/scores"
        words={scoresWords(locale)}
        forecastWords={forecastBarWords(locale)}
      />,
    );

  it('opens on the outcomes, and holds the community split back until the reader picks', () => {
    const before = preview(member, null);
    expect(before).toContain('id="pick"');
    expect(before).toContain('data-testid="pick-control" data-pick="open"');
    expect(before).toContain('<button type="submit" value="home" aria-pressed="false"');
    expect(before).not.toContain('community-split');
    const after = preview(member, pick);
    expect(after).toContain('data-pick="saved"');
    expect(after).toContain('community-split');
  });

  it('shows a guest the three outcomes as links towards an account, and no split', () => {
    const html = preview(null, null);
    expect(html).toContain('data-testid="pick-control" data-pick="open"');
    expect(html).toContain(
      `href="/en/register?next=${encodeURIComponent(`/en/match/${ID}?pick=away#pick`)}"`,
    );
    expect(html).not.toContain('href="/en/login"');
    expect(html).not.toContain('community-split');
  });

  it('is a bottom sheet under 1024px: fixed, scrolling inside itself, over a scrim (T-1738)', () => {
    const html = preview(null, null);
    const section = /<section id="pick"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? '';
    for (const part of [
      'max-lg:fixed',
      'max-lg:inset-x-0',
      'max-lg:bottom-0',
      'max-lg:max-h-[70dvh]',
      'max-lg:overflow-y-auto',
    ]) {
      expect(section).toContain(part);
    }
    // Nothing fixed from 1024px, where it is the side column's card.
    expect(section).not.toMatch(/(^| )fixed( |$)/);
    // The scrim and the 44px close control are links back, without scrolling.
    expect(html).toMatch(
      /<a aria-hidden="true" tabindex="-1" class="fixed inset-0 z-50 [^"]*lg:hidden" data-testid="preview-scrim" href="\/en\/scores"/,
    );
    expect(html).toMatch(/class="[^"]*size-11[^"]*" data-testid="preview-close"/);
    // The sheet names the match on one line; the crest block is the desktop's.
    expect(html).toMatch(/lg:hidden" data-testid="preview-teams"/);
    // Unasked (the desktop's first open match), there is nothing to close and no scrim.
    const unasked = renderToStaticMarkup(
      <MatchPreview
        card={card({ kickoff_at: new Date(Date.now() + 86_400_000).toISOString() })}
        now={Date.now()}
        locale="en"
        timeZone="UTC"
        zone="UTC"
        me={null}
        current={null}
        consensus={null}
        forecast={AVAILABLE}
        community={{ state: 'below_floor' }}
        viewing={{ state: 'ask' }}
        words={scoresWords('en')}
        forecastWords={forecastBarWords('en')}
      />,
    );
    expect(unasked).not.toContain('preview-scrim');
    expect(unasked).not.toContain('preview-close');
  });

  it('shows the model beside the pick with its version and time, or says it has none', () => {
    const html = preview(member, null);
    expect(html).toContain('data-testid="forecast-bar"');
    expect(html).toContain('data-testid="forecast-bar-meta"');
    const none = preview(member, null, { state: 'none' });
    expect(none).toMatch(/data-testid="forecast-bar" data-state="none"/);
  });

  it('is in Persian on /fa', () => {
    expect(preview(member, null, AVAILABLE, 'fa')).toContain('انتخاب شما');
  });

  // T-1545: a live 1–1 read as a final one, and a guest after kick-off saw an empty "Your pick".
  const started = {
    kickoff_at: new Date(Date.now() - 74 * 60_000).toISOString(),
    last_updated_at: new Date(Date.now() - 30_000).toISOString(),
    scores: { ...card().scores, current: { home: 1, away: 1 } },
  };
  it('says under the score that the match is live, at which minute, and when it was updated', () => {
    const html = preview(null, null, AVAILABLE, 'en', { ...started, status: 'live', minute: 74 });
    expect(html).toMatch(/data-testid="preview-status" data-status="live">74′</);
    expect(html).toContain('data-testid="preview-updated"');
    expect(html).toMatch(/class="[^"]*text-live[^"]*" data-testid="preview-score"/);
  });

  it('draws a result its recorded goals disagree with quiet, and says it is unclear (T-1717, D-347)', () => {
    const finished = {
      ...started,
      status: 'finished' as const,
      scores: { ...started.scores, current: { home: 2, away: 0 }, full_time: { home: 2, away: 0 } },
    };
    const score_dispute = { recorded_goals: 4, reported: { home: 2, away: 0 } };
    const html = preview(null, null, AVAILABLE, 'en', { ...finished, score_dispute });
    expect(html).toContain('data-testid="preview-score-unclear"');
    expect(html).toContain('Score unclear in the source');
    expect(html).toMatch(/class="[^"]*text-muted[^"]*" data-testid="preview-score"/);
    expect(preview(null, null, AVAILABLE, 'en', finished)).not.toContain('preview-score-unclear');
    expect(preview(null, null, AVAILABLE, 'fa', { ...finished, score_dispute })).toContain(
      'نتیجه در منبع نامشخص است',
    );
  });

  it('says full time on a finished match and postponed on one with no score', () => {
    const done = preview(null, null, AVAILABLE, 'en', {
      ...started,
      status: 'finished',
      scores: { ...started.scores, full_time: { home: 2, away: 1 } },
    });
    expect(done).toMatch(/data-status="finished">FT</);
    expect(done).not.toContain('preview-updated');
    const off = preview(null, null, AVAILABLE, 'en', { status: 'postponed' });
    expect(off).not.toContain('preview-score');
    expect(off).toMatch(/data-status="postponed">Postponed</);
    expect(preview(member, null)).not.toContain('preview-status');
  });

  it('says awaiting an update under the "v" when the feed never moved past kick-off (T-1713)', () => {
    const html = preview(null, null, AVAILABLE, 'en', {
      kickoff_at: new Date(Date.now() - 5 * 3_600_000).toISOString(),
      freshness: 'awaiting_update',
    });
    expect(html).toMatch(/data-testid="preview-status" data-status="scheduled">Awaiting update</);
    expect(html).not.toContain('preview-score');
  });

  it('tells a guest after kick-off that picks are locked, without the note on making one', () => {
    const html = preview(null, null, AVAILABLE, 'en', { ...started, status: 'live', minute: 74 });
    expect(html).toContain('data-testid="pick-control" data-pick="locked"');
    expect(html).toContain('Locked at kick-off');
    expect(html).toContain('Picks lock at kick-off.');
    expect(html).not.toContain('/register');
    expect(html).not.toContain('No account is needed to choose');
    expect(preview(null, null)).toContain('No account is needed to choose');
    expect(preview(null, null)).not.toContain('data-pick="locked"');
  });

  it('draws the MODEL tag as an outline, which holds 4.5:1 in Day (T-1545)', () => {
    const html = preview(member, null);
    expect(html).toContain('rounded-sm border border-model');
    expect(html).not.toContain('bg-model/15');
  });
});

describe('the Live view with nothing in play (T-1545)', () => {
  const empty = { ...({} as ScoresResponse), pinned: [], groups: [], total: 0 } as ScoresResponse;
  const list = (live: boolean, locale: 'en' | 'fa' = 'en'): string =>
    renderToStaticMarkup(
      <LiveScores
        initial={{ ...empty, generated_at: '2026-10-25T21:37:00Z' } as ScoresResponse}
        streamQuery="date=2026-10-25"
        timeZone="UTC"
        locale={locale}
        filters={NO_FILTERS}
        clearFiltersHref="/en/scores"
        forecasts={{}}
        live={live}
        words={scoresWords(locale)}
      />,
    );

  it('says nothing is in play, not that the day has no match', () => {
    expect(list(true)).toContain('No match on this day is in play.');
    expect(list(true)).not.toContain('No fixtures on this day.');
    expect(list(false)).toContain('No fixtures on this day.');
    expect(list(true, 'fa')).toContain('در این روز هیچ مسابقه‌ای در جریان نیست.');
  });
});
