import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type CompetitionDirectoryEntry,
  NO_MEDIA,
  type ScoreCard,
  type ScoresResponse,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { railView } from './matchday-rail';
import { MatchdayRailView, isCompetitionPath } from './matchday-rail-view';

/**
 * The matchday rail drawn (T-1624, D-292): one bar under the header in place
 * of the competitions bar and the live strip. Each league with its status; a
 * league playing today a toggle that opens its drawer, the rest links; the
 * default drawer drawn by the server; no drawer on a day without a match;
 * compact on a phone; Persian on /fa; only logical CSS.
 */

let pathname = '/en';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const HEADER = readFileSync(join(__dirname, 'site-header.tsx'), 'utf8');
const SOURCES = ['matchday-rail.tsx', 'matchday-rail-view.tsx', 'scroll-row.tsx', 'live-strip.tsx']
  .map((file) => readFileSync(join(__dirname, file), 'utf8'))
  .join('\n');

const NOW = Date.parse('2026-10-24T18:00:00.000Z');

function entry(id: string, name: string, over: Partial<CompetitionDirectoryEntry> = {}) {
  return {
    id,
    name,
    short_name: null,
    scope: 'domestic' as const,
    kind: 'league' as const,
    country: null,
    order: null,
    logo: NO_MEDIA,
    season: null,
    next_kickoff_at: null,
    ...over,
  };
}

function card(id: string, over: Partial<ScoreCard>): ScoreCard {
  return {
    id,
    kickoff_at: '2026-10-24T19:00:00.000Z',
    status: 'scheduled',
    minute: null,
    competition: { id: 'c', name: 'C', short_name: null, country_id: null },
    season: { id: 's', label: '2026/27' },
    stage: null,
    round: null,
    leg: null,
    home: { id: 'h', name: 'Tractor', short_name: null, code: 'TRA' },
    away: { id: 'a', name: 'Esteghlal', short_name: null, code: 'EST' },
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
    last_updated_at: '2026-10-24T17:59:50.000Z',
    freshness: null,
    pinned: false,
    ...over,
  };
}

const DIRECTORY = [
  entry('pgpl', 'Pro League', { next_kickoff_at: '2026-10-29T15:00:00Z' }),
  entry('laliga', 'LaLiga'),
  entry('epl', 'Premier League', { short_name: 'PL' }),
];

function scores(groups: { id: string; name: string; fixtures: ScoreCard[] }[]): ScoresResponse {
  return {
    filters: {
      from: '2026-10-24',
      to: '2026-10-24',
      timezone: 'Europe/London',
      live: false,
      favourites: false,
      country_id: null,
      competition_id: null,
      stage_id: null,
      gender: null,
      age: null,
    },
    generated_at: '2026-10-24T17:59:55.000Z',
    total: 0,
    pinned: [],
    groups: groups.map((g) => ({
      country: null,
      competition: { id: g.id, name: g.name, short_name: null },
      fixtures: g.fixtures,
    })),
  };
}

const MATCHDAY = scores([
  { id: 'laliga', name: 'LaLiga', fixtures: [card('m1', {})] },
  {
    id: 'epl',
    name: 'Premier League',
    fixtures: [
      card('m2', {
        status: 'live',
        minute: 61,
        scores: { ...card('x', {}).scores, current: { home: 1, away: 0 } },
      }),
      card('m3', {
        status: 'live',
        minute: 58,
        scores: { ...card('x', {}).scores, current: { home: 0, away: 0 } },
      }),
    ],
  },
]);

const draw = (
  locale: 'en' | 'fa',
  answer: ScoresResponse | null,
  { signedIn = false, directory = DIRECTORY } = {},
) =>
  renderToStaticMarkup(
    <MatchdayRailView
      {...railView({
        locale,
        timeZone: locale === 'fa' ? 'Asia/Tehran' : 'Europe/London',
        signedIn,
        directory,
        scores: answer,
        now: NOW,
      })}
    />,
  );

/** Each chip's opening tag, in the rail's order. */
const chips = (html: string): string[] =>
  [...html.matchAll(/<(?:a|button) [^>]*data-testid="competitions-bar-item"[^>]*>/g)].map(
    (m) => m[0],
  );
const idOf = (tag: string) => /data-competition="([^"]+)"/.exec(tag)?.[1];

beforeEach(() => {
  pathname = '/en';
});

describe('on a match day', () => {
  const html = draw('en', MATCHDAY);

  it('orders the leagues by what is happening: live, later today, then the rest', () => {
    expect(chips(html).map(idOf)).toEqual(['epl', 'laliga', 'pgpl']);
  });

  it('gives each its status: the live count with the dot, the next kick-off, the next match day', () => {
    const statuses = [
      ...html.matchAll(/data-testid="rail-status"[^>]*>([\s\S]*?)<\/(?:span|time)>/g),
    ];
    expect(html).toMatch(
      /class="rail-status" data-kind="live"[^>]*><span aria-hidden="true" class="live-dot/,
    );
    expect(html).toContain('2 live');
    expect(html).toMatch(
      /<time dateTime="2026-10-24T19:00:00.000Z"[^>]*data-kind="later"[^>]*>20:00<\/time>/,
    );
    expect(html).toMatch(
      /<time dateTime="2026-10-29T15:00:00Z"[^>]*data-kind="day"[^>]*>Thu<\/time>/,
    );
    expect(statuses).toHaveLength(3);
  });

  it('makes a league playing today a toggle for the drawer, the rest links to their page', () => {
    const [epl, laliga, pgpl] = chips(html);
    expect(epl).toMatch(/^<button type="button" aria-pressed="true" aria-controls="rail-drawer"/);
    expect(laliga).toMatch(
      /^<button type="button" aria-pressed="false" aria-controls="rail-drawer"/,
    );
    expect(pgpl).toMatch(/^<a [^>]*href="\/en\/competition\/pgpl"/);
    // The short name, isolated.
    expect(html).toContain('<bdi>PL</bdi>');
  });

  it('opens the drawer on the first league playing today, drawn by the server', () => {
    const drawer =
      /<div id="rail-drawer" data-testid="rail-drawer">([\s\S]*)<\/div>$/.exec(html)?.[1] ?? '';
    expect(drawer).toMatch(
      /<nav aria-labelledby="live-strip-label" data-testid="live-strip" data-competition="epl"/,
    );
    expect(drawer).toContain('Today · PL');
    expect(drawer.match(/data-testid="strip-chip"/g)).toHaveLength(2);
    expect(drawer).toContain('href="/en/match/m2"');
    // LaLiga's match is not in the page until its chip is pressed.
    expect(html).not.toContain('/en/match/m1');
    expect(drawer).toContain('Open PL');
    expect(drawer).toContain('href="/en/competition/epl"');
  });

  it('keeps on a phone only the leagues playing today, and the drawer', () => {
    const root = /<div data-testid="matchday-rail"[^>]*>/.exec(html)?.[0] ?? '';
    expect(root).not.toContain('max-md:hidden');
    const items = [
      ...html.matchAll(/<li( class="[^"]*")?><(?:a|button) [^>]*data-competition="(\w+)"/g),
    ];
    expect(items.map((m) => [m[2], (m[1] ?? '').includes('max-md:hidden')])).toEqual([
      ['epl', false],
      ['laliga', false],
      ['pgpl', true],
    ]);
    expect(html).toMatch(/<li class="max-md:hidden"><a [^>]*data-testid="competitions-bar-all"/);
  });
});

describe('on a day without a match', () => {
  for (const [why, answer] of [
    ['nothing is played', scores([{ id: 'epl', name: 'Premier League', fixtures: [] }])],
    ['today could not be read', null],
  ] as const) {
    it(`has no drawer when ${why}, and nothing on a phone`, () => {
      const html = draw('en', answer);
      expect(html).not.toContain('rail-drawer');
      expect(html).not.toContain('live-strip');
      expect(html).not.toContain('aria-pressed');
      expect(/<div data-testid="matchday-rail"[^>]*>/.exec(html)?.[0]).toContain('max-md:hidden');
      // The leagues are links in the product's order, Pro League's next match day beside it.
      expect(chips(html).map(idOf)).toEqual(['pgpl', 'laliga', 'epl']);
      expect(html).toContain('>Thu</time>');
    });
  }

  it('is All competitions alone when no list could be read (rule 3)', () => {
    const html = draw('en', null, { directory: [] });
    expect(html.match(/<li/g)).toHaveLength(1);
    expect(html).toContain('href="/en/competitions"');
  });
});

describe('the rail', () => {
  it('is the named landmark the bar was, All competitions last with its arrow', () => {
    const html = draw('en', null);
    expect(html).toMatch(/<nav aria-label="Competitions" data-testid="competitions-bar"/);
    expect([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual([
      '/en/competition/pgpl',
      '/en/competition/laliga',
      '/en/competition/epl',
      '/en/competitions',
    ]);
    expect(html).toContain(
      '<span aria-hidden="true" class="inline-block rtl:-scale-x-100">→</span>',
    );
    expect(html).not.toContain('aria-current');
  });

  it('marks the competition being read and All competitions on its page', () => {
    pathname = '/en/competition/laliga/table';
    expect(isCompetitionPath('/en/competition/laliga', 'en', 'laliga')).toBe(true);
    expect(isCompetitionPath('/en/competition/laliga2', 'en', 'laliga')).toBe(false);
    expect(draw('en', null)).toMatch(/aria-current="page"[^>]*data-competition="laliga"/);
    pathname = '/en/competitions';
    expect(draw('en', null)).toMatch(/aria-current="page"[^>]*data-testid="competitions-bar-all"/);
  });

  it('opens with My teams for a member, never for a guest', () => {
    const member = draw('en', MATCHDAY, { signedIn: true });
    const first = /<li[^>]*><a [^>]*>/.exec(member)?.[0] ?? '';
    expect(first).toContain('href="/en/scores?favourites=1"');
    expect(first).toContain('data-testid="rail-my-teams"');
    expect(first).toContain('max-md:hidden');
    expect(member).toContain('My teams');
    expect(draw('en', MATCHDAY)).not.toContain('rail-my-teams');
  });

  it('hides the native scrollbar for fades and chevrons that stay out of the tab order', () => {
    const html = draw('en', MATCHDAY);
    const chevrons = [...html.matchAll(/<button [^>]*class="scroll-chevron"[^>]*>/g)].map(
      (m) => m[0],
    );
    // Two on the rail, two in the drawer, none shown until the island measures.
    expect(chevrons).toHaveLength(4);
    for (const chevron of chevrons) {
      expect(chevron).toContain('tabindex="-1"');
      expect(chevron).toContain('aria-hidden="true"');
    }
    expect(html).not.toContain('data-more-');
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/@utility scroll-row \{[\s\S]*?scrollbar-width: none;/);
    expect(css).toMatch(/&\[aria-pressed='true'\] > span \{\s*@apply border-accent/);
  });

  it('is in Persian on /fa: the words, the digits and the time in Tehran', () => {
    const html = draw('fa', MATCHDAY);
    expect(html).toContain('aria-label="رقابت‌ها"');
    expect(html).toContain('همه رقابت‌ها');
    expect(html).toContain('۲ زنده');
    // 19:00 UTC is 22:30 in Tehran.
    expect(html).toContain('>۲۲:۳۰</time>');
    expect(html).toContain('صفحه‌ی PL');
    expect(draw('fa', MATCHDAY, { signedIn: true })).toContain('تیم‌های من');
    expect(html).not.toContain('data-translation="untranslated"');
  });

  it('sits right under the header, before the lite banner, in place of the two bars', () => {
    const header = HEADER.indexOf('</header>');
    const rail = HEADER.indexOf('<MatchdayRail');
    expect(header).toBeGreaterThan(0);
    expect(rail).toBeGreaterThan(header);
    expect(rail).toBeLessThan(HEADER.indexOf('{banner}'));
    expect(HEADER).not.toContain('<LiveStrip');
    expect(HEADER).not.toContain('<CompetitionsBar');
  });

  it("keeps the contracts package off every page's first load (T-808)", () => {
    for (const file of ['matchday-rail-view.tsx', 'scroll-row.tsx']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).toMatch(/^'use client';/);
      expect(source).not.toMatch(/from '@\/components\/entity-image'/);
      expect(source).not.toMatch(/from '@fmip\/contracts'/);
      expect(source).not.toMatch(/from '@\/i18n\/messages'(?!;)/);
    }
  });

  it('uses logical properties only (rule 7)', () => {
    expect(SOURCES).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-[\w[]/);
    expect(SOURCES).not.toMatch(/text-(?:left|right)\b/);
  });
});
