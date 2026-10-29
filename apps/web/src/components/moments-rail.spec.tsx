import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Moment,
  type MomentForecast,
  type MomentsResponse,
  STALE_LIVE_AFTER_MS,
  type ScoreCard,
} from '@fmip/contracts';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { refreshRail } from '@/lib/rail-actions';
import { MOMENTS_RETRY_MS } from '@/lib/moments-rail';
import { momentsView } from './moments-rail';
import {
  CLOSED,
  HOVER_QUERY,
  MomentsRailView,
  OPEN_DELAY_MS,
  hoverAfter,
  panelAlign,
} from './moments-rail-view';

/**
 * The moments rail drawn (T-1642, D-300), in place of D-292's matchday rail
 * and its drawer: the lead, a card per moment in the answer's order, the
 * model line only where a forecast exists (rule 3), "May be behind" on a
 * stale live card (rule 4), the "N more" links, the hover card with the
 * forecast, its receipt and the way on, nothing at all with no moment or no
 * answer, Persian on /fa, only logical CSS, and the client half kept small.
 */

vi.mock('next/navigation', () => ({ unstable_isUnrecognizedActionError: () => false }));

const NOW = Date.parse('2026-10-24T18:00:00.000Z');
const minutes = (n: number) => new Date(NOW + n * 60_000).toISOString();
const SOURCES = ['moments-rail.tsx', 'moments-rail-view.tsx']
  .map((file) => readFileSync(join(__dirname, file), 'utf8'))
  .join('\n');
const HEADER = readFileSync(join(__dirname, 'site-header.tsx'), 'utf8');

function card(id: string, over: Partial<ScoreCard> = {}): ScoreCard {
  return {
    id,
    kickoff_at: minutes(120),
    status: 'scheduled',
    minute: null,
    competition: { id: 'c-epl', name: 'Premier League', short_name: null, country_id: null },
    season: { id: 's', label: '2026/27' },
    stage: null,
    round: 'Regular Season - 9',
    leg: null,
    home: { id: `${id}-h`, name: 'Arsenal', short_name: null, code: 'ARS' },
    away: { id: `${id}-a`, name: 'Chelsea', short_name: null, code: 'CHE' },
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
    last_updated_at: minutes(-1),
    live_answered_at: null,
    freshness: null,
    pinned: false,
    ...over,
  };
}

const FORECAST: MomentForecast = {
  home: 0.2212,
  draw: 0.2476,
  away: 0.5312,
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: '2026-10-23T09:30:00.000Z',
};

const score = (home: number, away: number, full = false) => ({
  ...card('x').scores,
  current: { home, away },
  full_time: full ? { home, away } : null,
});

const live = (
  id: string,
  minute: number,
  home: number,
  away: number,
  over: Partial<ScoreCard> = {},
) =>
  card(id, {
    status: 'live',
    minute,
    kickoff_at: minutes(-minute - 15),
    scores: score(home, away),
    last_updated_at: minutes(-0.5),
    live_answered_at: minutes(-0.2),
    freshness: 'current',
    ...over,
  });

const m = (kind: Moment['kind'], fixture: ScoreCard, over: Partial<Moment> = {}): Moment => ({
  kind,
  followed: false,
  fixture,
  forecast: FORECAST,
  side: null,
  minutes_left: null,
  ...over,
});

const MOMENTS: Moment[] = [
  m('against_forecast', live('m1', 80, 1, 0), { side: 'home' }),
  m('level_late', live('m2', 78, 2, 2), { minutes_left: 12 }),
  m('big_one', card('m3', { kickoff_at: '2026-10-24T19:00:00.000Z' })),
  m('starting_soon', card('m4', { kickoff_at: minutes(18) }), { forecast: null }),
  m('upset', card('m5', { status: 'finished', scores: score(0, 2, true) }), { side: 'away' }),
  m('coming_up', card('m6', { kickoff_at: '2026-10-25T14:00:00.000Z' })),
];

const answer = (moments: Moment[], over: Partial<MomentsResponse> = {}): MomentsResponse => ({
  generated_at: minutes(-0.1),
  timezone: 'Europe/London',
  live_count: 3,
  today_count: 42,
  moments,
  ...over,
});

const view = (
  locale: string,
  a: MomentsResponse | null,
  { signedIn = false, timeZone = 'Europe/London' } = {},
) => momentsView({ locale, timeZone, signedIn, answer: a, now: NOW });

const draw = (props: ReturnType<typeof view>) =>
  renderToStaticMarkup(<MomentsRailView {...props} />);
const html = (node: ReactNode) => renderToStaticMarkup(<>{node}</>);
/** The markup of every `data-testid="…"` element's opening tag, in order. */
const tags = (markup: string, testId: string) =>
  [...markup.matchAll(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`, 'g'))].map(
    ([tag]) => tag,
  );

describe('the rail on a match day', () => {
  const rail = view('en', answer(MOMENTS));
  const out = draw(rail);

  it('leads with the live count, what the cards were picked from and Leagues', () => {
    expect(out).toContain('data-testid="moments-rail"');
    expect(out).toMatch(/data-testid="moments-live"[^>]*>.*live-dot moments-dot.*3 live<\/p>/);
    expect(out).toContain(
      'Picked from 42 matches by what is happening and what the model expected',
    );
    // The link without a script; from 1024px the competitions menu's button (T-1643).
    expect(tags(out, 'moments-leagues')[0]).toContain('href="/en/competitions"');
    expect(out).toContain('<h2 id="moments-title" class="sr-only">Moments that matter</h2>');
  });

  it('keeps the dot still and the count muted when nothing is live', () => {
    const quiet = draw(view('en', answer(MOMENTS.slice(2), { live_count: 0 })));
    expect(quiet).toContain('data-count="0"');
    expect(quiet).not.toContain('live-dot');
    expect(quiet).toContain('0 live');
  });

  it('draws a card per moment in the answer’s order, each a link to its match', () => {
    expect(tags(out, 'moment').map((tag) => /data-moment="([^"]+)"/.exec(tag)?.[1])).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
      'm6',
    ]);
    const links = tags(out, 'moment-card');
    expect(links[0]).toContain('href="/en/match/m1"');
    // The first card is edged in saffron, the rest in the hairline.
    expect(links[0]).toContain('data-first="true"');
    expect(links.slice(1).some((tag) => tag.includes('data-first'))).toBe(false);
  });

  it('writes each eyebrow, saffron while the match is played, and its time at the end', () => {
    const eyebrows = tags(out, 'moment-eyebrow');
    expect(eyebrows.map((tag) => /data-tone="(\w+)"/.exec(tag)?.[1])).toEqual([
      'live',
      'live',
      'calm',
      'calm',
      'calm',
      'calm',
    ]);
    for (const words of [
      'Against the forecast',
      'Level, 12 min to go',
      'Big one tonight',
      'Starts in 18 min',
      'Upset',
      'Coming up Sun',
    ]) {
      expect(out).toContain(words);
    }
    expect(out).toContain('>80′<');
    expect(out).toContain('class="moment-when" data-testid="moment-when">20:00</time>');
    expect(out).toContain('>FT<');
  });

  it('shows the goals in play and at full time, and none before kick-off', () => {
    const teams = tags(out, 'moment-team');
    expect(teams).toHaveLength(12);
    expect(teams[0]).toContain('data-state="live"');
    // The upset's winner bold, the loser muted.
    expect(teams[8]).toContain('data-result="lost"');
    expect(teams[9]).toContain('data-result="won"');
    // m3 (to come) has no goals: four live lines and two final ones carry them.
    expect(tags(out, 'moment-score')).toHaveLength(6);
  });

  it('says the model line from the numbers, and never without a forecast (rule 3)', () => {
    expect(tags(out, 'moment-model')).toHaveLength(5);
    expect(out).toContain('Arsenal lead; before kick-off the model gave them 22%.');
    expect(out).toContain('Chelsea won; the model gave them 53%.');
    expect(out).toMatch(/class="moment-tag">Model</);
    const soon = out.slice(out.indexOf('data-moment="m4"'), out.indexOf('data-moment="m5"'));
    expect(soon).not.toContain('moment-model');
  });

  it('carries one "N more" link per row width, to the scores page', () => {
    const more = tags(out, 'moments-more');
    expect(more.map((tag) => /data-shown="(\d)"/.exec(tag)?.[1])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(more[3]).toContain('aria-label="2 more matches on the scores page"');
    expect(more[3]).toContain('href="/en/scores"');
    expect(out).toContain('>2 more<');
  });

  it('puts no hover card in the page until one is opened', () => {
    expect(out).not.toContain('moment-panel');
    expect(out).not.toContain('moment-float');
  });

  it('is asked for again every half-minute while anything is played', () => {
    expect(rail.askIn).toBe(0);
    expect(rail.behindAt).toBe(Date.parse(minutes(-0.1)) + STALE_LIVE_AFTER_MS);
    expect(rail.behind).toBe(false);
  });
});

describe('when it may be behind (rule 4)', () => {
  it('says so on a live card whose data stopped', () => {
    const stale = view(
      'en',
      answer([m('level_late', live('s1', 78, 1, 1, { freshness: 'stale' }))]),
    );
    const out = draw(stale);
    expect(out).toContain(
      '<span class="moment-behind" data-testid="moment-behind">May be behind</span>',
    );
    expect(out).toContain('>Behind<');
    expect(stale.behind).toBe(true);
    expect(out).toContain('data-testid="moments-rail" data-behind="true"');
  });

  it('holds the words ready on a fresh live card, for when the answers stop coming', () => {
    const out = draw(view('en', answer([m('level_late', live('f1', 78, 1, 1))])));
    expect(out).toContain('moment-behind hidden group-data-[behind=true]/moments:block');
    expect(out).toContain('hidden text-warning group-data-[behind=true]/moments:inline');
    expect(out).not.toContain('data-behind="true"');
  });

  it('never on a match that is over or still to come', () => {
    const out = draw(view('en', answer(MOMENTS.slice(2), { live_count: 0 })));
    expect(out).not.toContain('moment-behind');
  });
});

describe('a quiet day, or no answer', () => {
  it('draws nothing at all: no empty bar (rule 3)', () => {
    expect(draw(view('en', answer([], { live_count: 0, today_count: 0 })))).toBe('');
    expect(draw(view('en', null))).toBe('');
  });

  it('keeps asking, so the rail appears once there is something to show', () => {
    expect(view('en', null).askIn).toBe(MOMENTS_RETRY_MS);
    expect(view('en', answer([], { live_count: 0 })).askIn).toBeGreaterThan(0);
    expect(view('en', answer([], { live_count: 2 })).askIn).toBe(0);
  });
});

describe('the hover card', () => {
  const rail = view('en', answer(MOMENTS));
  const panel = (i: number, props = rail) => html(props.moments[i]!.panel);

  it('names the competition and round, the minute, both teams and their goals', () => {
    const out = panel(0);
    expect(out).toContain('data-testid="moment-panel"');
    expect(out).toContain('role="group" aria-labelledby="moment-m1-title"');
    expect(out).toContain(
      'id="moment-m1-title" class="moment-panel-eyebrow"><bdi>Premier League</bdi> · Matchweek 9</p>',
    );
    expect(out).toContain('data-live-badge');
    expect(out).toContain('Live · ');
    expect(tags(out, 'moment-team').every((tag) => tag.includes('moment-team-big'))).toBe(true);
  });

  it('says the forecast in one sentence over the bar, with its receipt', () => {
    const out = panel(0);
    expect(out).toContain('Before kick-off the model gave Arsenal 22%, the draw 25%, Chelsea 53%.');
    expect(out).toContain('data-segment="home"');
    expect(out).toMatch(/data-testid="moment-panel-receipt"/);
    expect(out).toContain('dixon-coles-elo<span>@</span>0.6.0');
    expect(out).toContain('last version before kick-off');
    // Computed at 09:30 UTC, 10:30 in London.
    expect(out).toMatch(/<time dateTime="2026-10-23T09:30:00.000Z">23 Oct, 10:30<\/time>/i);
  });

  it('says there was no forecast rather than drawing an empty bar (rule 3)', () => {
    const out = panel(3);
    expect(out).toContain('data-state="none"');
    expect(out).toContain('No model forecast for this match yet.');
    expect(out).not.toContain('moment-panel-receipt');
  });

  it('leads to the match centre, and offers a member the moment’s team to follow', () => {
    expect(tags(panel(0), 'moment-panel-open')[0]).toContain('href="/en/match/m1"');
    expect(panel(0)).not.toContain('moment-panel-follow');
    const member = view('en', answer(MOMENTS), { signedIn: true });
    const upset = panel(4, member);
    expect(upset).toContain('data-testid="moment-panel-follow"');
    expect(upset).toContain('name="entity_type" value="team"');
    // The upset is about its winner.
    expect(upset).toContain('name="entity_id" value="m5-a"');
    expect(upset).toContain('Follow Chelsea');
    // A match of a team the member follows offers nothing more to follow.
    const followed = view('en', answer([m('followed', card('f1'), { followed: true })]), {
      signedIn: true,
    });
    expect(panel(0, followed)).not.toContain('moment-panel-follow');
  });

  it('stamps when the rail last heard, in the reader’s zone', () => {
    const out = panel(0);
    expect(out).toContain('data-testid="moment-panel-stamp"');
    expect(out).toContain('Updated 18:59 · ');
  });

  it('opens on a rest of 150 ms or the keyboard, closes on leaving and on Esc', () => {
    expect(OPEN_DELAY_MS).toBe(150);
    expect(HOVER_QUERY).toBe('(hover: hover) and (pointer: fine) and (min-width: 48rem)');
    let state = hoverAfter(CLOSED, { type: 'open', id: 'm1' });
    expect(state).toEqual({ open: 'm1', dismissed: null });
    state = hoverAfter(state, { type: 'open', id: 'm2' });
    expect(state.open).toBe('m2');
    // Esc closes it and keeps it closed while the focus stays on that card…
    state = hoverAfter(state, { type: 'escape' });
    expect(state).toEqual({ open: null, dismissed: 'm2' });
    expect(hoverAfter(state, { type: 'open', id: 'm2' })).toEqual(state);
    // …another card still opens, and leaving the card forgets the Esc.
    expect(hoverAfter(state, { type: 'open', id: 'm3' }).open).toBe('m3');
    state = hoverAfter(state, { type: 'leave', id: 'm2' });
    expect(state).toEqual(CLOSED);
    expect(
      hoverAfter(hoverAfter(CLOSED, { type: 'open', id: 'm1' }), { type: 'leave', id: 'm1' }),
    ).toEqual(CLOSED);
    // Leaving one card does not close another's.
    expect(hoverAfter({ open: 'm1', dismissed: null }, { type: 'leave', id: 'm2' }).open).toBe(
      'm1',
    );
  });

  it('goes with its card when a new answer no longer has it', () => {
    const open = { open: 'm1', dismissed: null };
    expect(hoverAfter(open, { type: 'shown', ids: ['m1', 'm2'] })).toBe(open);
    expect(hoverAfter(open, { type: 'shown', ids: ['m2'] }).open).toBeNull();
  });

  it('sits from its card’s inline start, or its end when the window has no room', () => {
    expect(panelAlign(600, 368)).toBe('start');
    expect(panelAlign(380, 368)).toBe('end');
  });

  it('floats: absolutely placed, so opening it moves nothing on the page', () => {
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/\.moment-float \{\s*@apply absolute top-full z-40 w-\[23rem\]/);
    expect(css).toMatch(/\.moment-slot \{\s*@apply relative;/);
  });
});

describe('in Persian', () => {
  const out = draw(view('fa', answer(MOMENTS), { timeZone: 'Asia/Tehran' }));

  it('speaks Persian with Persian digits, the time in Tehran', () => {
    expect(out).toContain('۳ زنده');
    expect(out).toContain('برگزیده از ۴۲ بازی');
    expect(out).toContain('خلاف پیش‌بینی');
    expect(out).toContain('مساوی، ۱۲ دقیقه مانده');
    expect(out).toContain('>۸۰′<');
    expect(out).toContain('>۲۲:۳۰</time>');
    expect(out).toContain('Arsenal جلو است؛ مدل پیش از شروع بازی به آن ۲۲٪ شانس داده بود.');
    expect(out).toContain('>۲ بازی دیگر<');
    expect(out).toContain('>لیگ‌ها<');
    expect(out).not.toContain('data-translation="untranslated"');
  });
});

describe('the rail in the shell', () => {
  it('sits right under the header, before the lite banner, in place of the matchday rail', () => {
    const header = HEADER.indexOf('</header>');
    const rail = HEADER.indexOf('<MomentsRail');
    expect(header).toBeGreaterThan(0);
    expect(rail).toBeGreaterThan(header);
    expect(rail).toBeLessThan(HEADER.indexOf('{banner}'));
    expect(HEADER).not.toContain('<MatchdayRail');
  });

  it("keeps the contracts package and the catalogues off every page's first load (T-808)", () => {
    const client = readFileSync(join(__dirname, 'moments-rail-view.tsx'), 'utf8');
    expect(client).toMatch(/^'use client';/);
    expect(client).not.toMatch(/from '@\/components\/entity-image'/);
    expect(client).not.toMatch(/from '@fmip\/contracts'/);
    expect(client).not.toMatch(/from '@\/i18n\/messages'/);
    expect(client).not.toMatch(/from '@\/lib\/moments-rail'/);
  });

  it('asks the server to draw it again rather than drawing cards itself', () => {
    const client = readFileSync(join(__dirname, 'moments-rail-view.tsx'), 'utf8');
    expect(client).toContain("import { refreshRail } from '@/lib/rail-actions';");
    expect(client).toContain('LIVE_MOVED');
    const action = readFileSync(join(__dirname, '../lib/rail-actions.ts'), 'utf8');
    expect(action).toMatch(/^'use server';/);
    expect(action).toContain('loadMoments(');
  });

  it('answers nothing for a language or a zone it does not know', async () => {
    expect(await refreshRail('xx', 'Europe/London', false, false)).toBeNull();
    expect(await refreshRail('en', 'Mars/Olympus', false, false)).toBeNull();
  });

  it('uses logical properties only (rule 7)', () => {
    expect(SOURCES).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-[\w[]/);
    expect(SOURCES).not.toMatch(/text-(?:left|right)\b/);
  });
});
