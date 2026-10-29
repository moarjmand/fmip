import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type CompetitionDirectoryEntry,
  NO_MEDIA,
  type ScoreCard,
  type ScoresResponse,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { refreshCompetitionsMenu } from '@/lib/competitions-menu-actions';
import { COMPETITIONS_MENU_ID } from '@/lib/competitions-menu-state';
import { menuFrameWords, menuView } from './competitions-menu';
import MenuPanel, { CompetitionsMenuBody } from './competitions-menu-panel';
import { CompetitionsMenuPanel, CompetitionsMenuTrigger } from './competitions-menu-view';

/**
 * The competitions menu drawn (T-1643, D-301): every competition by region
 * with its status, the counts and toggles from today's scores, nothing
 * guessed when an answer is missing, Persian on /fa, the trigger a link
 * without a script, and only logical CSS.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/en' }));

const NOW = Date.parse('2026-10-29T18:00:00.000Z');
const ZONE = 'Europe/London';

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

const ENGLAND = { id: 'eng', name: 'England', code: 'ENG' };
const IRAN = { id: 'irn', name: 'Iran', code: 'IRN' };

const DIRECTORY: CompetitionDirectoryEntry[] = [
  entry('epl', 'Premier League', { country: ENGLAND, order: 1, confederation: 'uefa' }),
  entry('ucl', 'UEFA Champions League', {
    scope: 'continental',
    kind: 'cup',
    order: 2,
    confederation: 'uefa',
    next_kickoff_at: '2026-11-04T20:00:00.000Z',
  }),
  entry('champ', 'Championship', { country: ENGLAND, order: 3, confederation: 'uefa' }),
  entry('pgpl', 'Persian Gulf Pro League', {
    country: IRAN,
    order: 4,
    confederation: 'afc',
    next_kickoff_at: '2026-10-31T14:00:00.000Z',
  }),
  entry('facup', 'FA Cup', { kind: 'cup', country: ENGLAND, confederation: 'uefa' }),
  entry('wc', 'World Cup', { scope: 'international', kind: 'cup', confederation: null }),
];

function card(id: string, over: Partial<ScoreCard>): ScoreCard {
  return {
    id,
    kickoff_at: '2026-10-29T19:00:00.000Z',
    status: 'scheduled',
    minute: null,
    competition: { id: 'c', name: 'C', short_name: null, country_id: null },
    season: { id: 's', label: '2026/27' },
    stage: null,
    round: null,
    leg: null,
    home: { id: 'h', name: 'H', short_name: null, code: 'HHH' },
    away: { id: 'a', name: 'A', short_name: null, code: 'AAA' },
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
    last_updated_at: '2026-10-29T17:59:50.000Z',
    freshness: null,
    pinned: false,
    ...over,
  };
}

const SCORES: ScoresResponse = {
  filters: {
    from: '2026-10-29',
    to: '2026-10-29',
    timezone: ZONE,
    live: false,
    favourites: false,
    country_id: null,
    competition_id: null,
    stage_id: null,
    gender: null,
    age: null,
  },
  generated_at: '2026-10-29T17:59:55.000Z',
  total: 3,
  pinned: [],
  groups: [
    {
      country: null,
      competition: { id: 'epl', name: 'Premier League', short_name: null },
      fixtures: [card('m1', { status: 'live', minute: 61 }), card('m2', {})],
    },
    {
      country: null,
      competition: { id: 'champ', name: 'Championship', short_name: null },
      fixtures: [card('m3', { status: 'finished', kickoff_at: '2026-10-29T12:00:00.000Z' })],
    },
    {
      country: null,
      competition: { id: 'facup', name: 'FA Cup', short_name: null },
      fixtures: [card('m4', { kickoff_at: '2026-10-29T19:45:00.000Z' })],
    },
  ],
};

const view = (locale = 'en', scores: ScoresResponse | null = SCORES, timeZone = ZONE) =>
  menuView({ locale, timeZone, directory: DIRECTORY, scores, now: NOW });

/** One row's markup, by competition id. */
function row(v: NonNullable<ReturnType<typeof menuView>>, id: string): string {
  const found = v.columns
    .flat()
    .flatMap((g) => g.rows)
    .find((r) => r.id === id);
  if (found === undefined) throw new Error(`no row ${id}`);
  return renderToStaticMarkup(<>{found.node}</>);
}

const WORDS = menuFrameWords('en');

describe('menuView', () => {
  it('is nothing at all without a directory, or with an empty one (rule 3)', () => {
    expect(
      menuView({ locale: 'en', timeZone: ZONE, directory: null, scores: SCORES, now: NOW }),
    ).toBeNull();
    expect(
      menuView({ locale: 'en', timeZone: ZONE, directory: [], scores: SCORES, now: NOW }),
    ).toBeNull();
  });

  it('files every competition in its column and group', () => {
    const v = view()!;
    expect(
      v.columns.map((column) => column.map((g) => [g.region, g.rows.map((r) => r.id)])),
    ).toEqual([
      [
        ['big-five', ['epl']],
        ['european-cups', ['ucl']],
      ],
      [['europe', ['champ']]],
      [
        ['cups', ['facup']],
        ['national', ['wc']],
      ],
      [['asia', ['pgpl']]],
    ]);
    expect(v.columns[0]![0]!.label.text).toBe('Big five');
    expect(v.columns[3]![0]!.label.text).toBe('Asia & Middle East');
  });

  it('counts the live, today’s and every competition, for the line and the toggles', () => {
    const v = view()!;
    expect(v.counts.text).toBe('1 with a match live · 3 playing today · 6 in all');
    expect(v.show).toEqual({
      all: { text: 'All 6', status: 'source' },
      today: { text: 'Today 3', status: 'source' },
      live: { text: 'Live 1', status: 'source' },
    });
    expect(v.counted[0]).toBe('0 competitions');
    expect(v.counted[1]).toBe('1 competition');
    expect(v.counted).toHaveLength(7);
    expect(v.numbers[6]).toBe('6');
    const flags = v.columns.flat().flatMap((g) => g.rows.map((r) => [r.id, r.live, r.today]));
    expect(flags).toContainEqual(['epl', true, true]);
    expect(flags).toContainEqual(['champ', false, true]);
    expect(flags).toContainEqual(['ucl', false, false]);
  });

  it('draws each row as a link to its page, with the logo, the name and one status', () => {
    const v = view()!;
    const epl = row(v, 'epl');
    expect(epl).toMatch(/^<a [^>]*href="\/en\/competition\/epl"/);
    expect(epl).toContain('class="menu-row"');
    expect(epl).toContain('data-testid="competitions-menu-item"');
    expect(epl).toContain('<bdi>Premier League</bdi>');
    expect(epl).toMatch(/data-kind="live"[^>]*>.*live-dot.*1 live<\/span>/);
    // Later today: the next kick-off in the reader's zone.
    expect(row(v, 'facup')).toMatch(
      /<time dateTime="2026-10-29T19:45:00.000Z"[^>]*data-kind="later"[^>]*>19:45<\/time>/,
    );
    // All over today: FT, and no next day known.
    expect(row(v, 'champ')).toMatch(
      /data-kind="finished"[^>]*><span class="font-bold">FT<\/span><\/span>/,
    );
    // Nothing today: the next match day, a weekday within six days, else a date.
    expect(row(v, 'pgpl')).toMatch(/data-kind="day"[^>]*>Sat<\/time>/);
    expect(row(v, 'ucl')).toMatch(/data-kind="day"[^>]*>Wed<\/time>/);
    // Nothing known: no status at all.
    expect(row(v, 'wc')).not.toContain('competitions-menu-status');
  });

  it('folds each row’s name, country and group for the filter', () => {
    const v = view()!;
    const pgpl = v.columns
      .flat()
      .flatMap((g) => g.rows)
      .find((r) => r.id === 'pgpl')!;
    expect(pgpl.fold).toBe('persian gulf pro league iran asia & middle east');
  });

  it('says what today could not tell, and offers no toggle that needs it', () => {
    const v = view('en', null)!;
    expect(v.counts.text).toBe('6 in all · today’s matches could not be read');
    expect(v.show).toBeNull();
    expect(v.stamp).toBeNull();
    expect(
      v.columns
        .flat()
        .flatMap((g) => g.rows)
        .every((r) => !r.live && !r.today),
    ).toBe(true);
    // The directory's next match day still stands.
    expect(row(v, 'pgpl')).toMatch(/>Sat<\/time>/);
  });

  it('says when today’s answer was heard, and that it may be behind once it has aged (rule 4)', () => {
    const v = view()!;
    const stamp = renderToStaticMarkup(<>{v.stamp}</>);
    expect(stamp).toContain('data-testid="competitions-menu-freshness"');
    expect(stamp).toContain('data-freshness="current"');
    expect(stamp).toMatch(
      /Last checked <time dateTime="2026-10-29T17:59:55.000Z">5 sec ago<\/time>/,
    );
    // The same answer read long after: a live match may have moved since.
    const late = menuView({
      locale: 'en',
      timeZone: ZONE,
      directory: DIRECTORY,
      scores: SCORES,
      now: NOW + 10 * 60_000,
    })!;
    expect(renderToStaticMarkup(<>{late.stamp}</>)).toContain('data-freshness="behind"');
    expect(v.note.text).toBe('Kick-off times in UK time · days are the next match day');
  });

  it('is in Persian on /fa, with Persian digits and the reader’s zone', () => {
    const v = view('fa', SCORES, 'Asia/Tehran')!;
    expect(v.counts.text).toBe('۱ با بازی زنده · ۳ با بازی امروز · ۶ در مجموع');
    expect(v.show?.live.text).toBe('زنده ۱');
    expect(v.columns[0]![0]!.label.text).toBe('پنج لیگ بزرگ');
    expect(v.note.text).toContain('به وقت تهران');
    expect(row(v, 'facup')).toContain('>۲۳:۱۵</time>');
    expect(row(v, 'champ')).toContain('>پایان</span>');
    expect(row(v, 'epl')).toContain('href="/fa/competition/epl"');
  });
});

describe('CompetitionsMenuBody', () => {
  const draw = (layout: 'columns' | 'stack') =>
    renderToStaticMarkup(
      <CompetitionsMenuBody
        view={view()!}
        layout={layout}
        filter={WORDS.filter}
        show={WORDS.show}
      />,
    );

  it('lays the panel out in five tracks, More of Europe across two in two columns', () => {
    const html = draw('columns');
    expect(html).toContain('data-layout="columns"');
    expect(html).toContain('class="grid grid-cols-5 gap-x-6 gap-y-5"');
    expect(html).toMatch(/<div class="col-span-2 [^"]*"><section [^>]*data-region="europe"/);
    expect(html).toMatch(/data-region="europe"[^]*?<ul class="grid grid-cols-2 gap-x-6">/);
    expect((html.match(/data-testid="competitions-menu-item"/g) ?? []).length).toBe(6);
  });

  it('stacks the groups on a phone, each row the 44px target', () => {
    const html = draw('stack');
    expect(html).toContain('data-layout="stack"');
    expect(html).not.toContain('grid-cols-5');
    expect(html).toContain('[&amp;_.menu-row]:min-h-touch');
  });

  it('labels the filter and offers All, Today and Live as toggles, All pressed', () => {
    const html = draw('columns');
    expect(html).toMatch(/<span class="sr-only">Filter competitions<\/span><input type="search"/);
    expect(html).toContain('placeholder="Filter competitions"');
    expect(html).toMatch(/role="group" aria-label="Show"/);
    expect(html).toMatch(/aria-pressed="true"[^>]*data-show="all"[^>]*>All 6</);
    expect(html).toMatch(/aria-pressed="false"[^>]*data-show="today"[^>]*>Today 3</);
    expect(html).toMatch(/aria-pressed="false"[^>]*data-show="live"[^>]*>Live 1</);
    // Each group named by its heading, its count beside it in the reader's digits.
    expect(html).toMatch(
      /<h3 id="[^"]+" class="menu-group-label">Big five<span aria-hidden="true" class="tabular-nums">1<\/span><\/h3>/,
    );
  });

  it('draws no toggle when today could not be read', () => {
    const html = renderToStaticMarkup(
      <CompetitionsMenuBody
        view={view('en', null)!}
        layout="stack"
        filter={WORDS.filter}
        show={WORDS.show}
        headingLevel={2}
      />,
    );
    expect(html).not.toContain('data-testid="competitions-menu-show"');
    expect(html).toMatch(/<h2 [^>]*class="menu-group-label"/);
  });
});

describe('the trigger and the panel', () => {
  it('is the link to the competitions page without a script (the server draws that)', () => {
    const html = renderToStaticMarkup(
      <CompetitionsMenuTrigger href="/en/competitions" current>
        Competitions
      </CompetitionsMenuTrigger>,
    );
    expect(html).toBe(
      '<a aria-current="page" data-testid="nav-competitions" class="nav-entry" href="/en/competitions">Competitions</a>',
    );
  });

  it('draws only the closed, empty place the trigger controls on the server', () => {
    const html = renderToStaticMarkup(
      <CompetitionsMenuPanel locale="en" timeZone={ZONE} words={WORDS} />,
    );
    expect(html).toBe(`<div id="${COMPETITIONS_MENU_ID}" hidden="" class="max-lg:hidden"></div>`);
  });

  it('draws the panel itself, its title naming it, the way to the page under it', () => {
    const html = renderToStaticMarkup(
      <MenuPanel locale="en" timeZone={ZONE} words={WORDS} open={false} />,
    );
    expect(html).toMatch(/role="dialog" aria-labelledby="([^"]+)"[^]*<h2 id="\1"/);
    expect(html).toContain('Loading every competition…');
    expect(html).toContain('href="/en/competitions"');
    expect(html).not.toContain('competitions-menu-item');
    expect(html).not.toContain('competitions-menu-scrim');
  });

  it('asks the server for the list, and keeps the panel off every page’s first load', () => {
    const shell = readFileSync(join(__dirname, 'competitions-menu-view.tsx'), 'utf8');
    expect(shell).toMatch(/^'use client';/);
    // The panel's code is fetched when needed; the shell names its words' type alone.
    expect(shell).toContain("lazy(() => import('@/components/competitions-menu-panel'))");
    expect(shell).toContain(
      "import type { MenuFrameWords } from '@/components/competitions-menu-panel';",
    );
    expect(shell).not.toMatch(/^import \{[^}]*\} from '@\/components\/competitions-menu-panel'/m);
    expect(shell).not.toContain('competitions-menu-actions');
    expect(shell).not.toContain('freshness-stamp');
    const client = readFileSync(join(__dirname, 'competitions-menu-panel.tsx'), 'utf8');
    expect(client).toMatch(/^'use client';/);
    expect(client).toContain(
      "import { refreshCompetitionsMenu } from '@/lib/competitions-menu-actions';",
    );
    for (const source of [shell, client]) {
      expect(source).not.toContain('@fmip/contracts');
      expect(source).not.toContain('freshness-stamp');
    }
    const action = readFileSync(join(__dirname, '../lib/competitions-menu-actions.ts'), 'utf8');
    expect(action).toMatch(/^'use server';/);
    expect(action).toContain('loadCompetitionsMenu(');
    const state = readFileSync(join(__dirname, '../lib/competitions-menu-state.ts'), 'utf8');
    expect(state).not.toMatch(/from '@fmip\/contracts'/);
    // Types only from the catalogues' module: the catalogues stay on the server.
    expect(state).not.toMatch(/^import \{[^}]*\} from '@\/i18n\/messages'/m);
  });

  it('answers nothing for a language or a zone it does not know', async () => {
    expect(await refreshCompetitionsMenu('xx', ZONE)).toBeNull();
    expect(await refreshCompetitionsMenu('en', 'Mars/Olympus')).toBeNull();
  });

  it('mounts once in the header, and the nav’s Competitions is its trigger', () => {
    const header = readFileSync(join(__dirname, 'site-header.tsx'), 'utf8');
    expect(header.match(/<CompetitionsMenu /g)).toHaveLength(1);
    const nav = readFileSync(join(__dirname, 'shell-nav.tsx'), 'utf8');
    expect(nav).toContain("link.id === 'competitions'");
    expect(nav).toContain('<CompetitionsMenuTrigger');
  });

  it('writes only logical CSS (rule 7)', () => {
    const sources = [
      'competitions-menu.tsx',
      'competitions-menu-view.tsx',
      'competitions-menu-panel.tsx',
    ]
      .map((file) => readFileSync(join(__dirname, file), 'utf8'))
      .join('\n');
    expect(sources).not.toMatch(
      /\b(?:ml|mr|pl|pr|left|right|text-left|text-right|border-l|border-r)-/,
    );
  });
});
