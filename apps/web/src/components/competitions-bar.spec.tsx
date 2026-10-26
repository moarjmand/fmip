import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NO_MEDIA } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attribute, message, plural } from '@/i18n/messages';
import { CompetitionsBarLinks, isCompetitionPath } from './competitions-bar-links';
import { CompetitionsDirectory } from './competitions-directory';

/**
 * The competitions bar and the All competitions page's list (T-1433), drawn:
 * the landmark, each competition to its page as a pill, "All competitions"
 * at the end (T-1513), the current one marked, the words in Persian, and
 * only logical CSS.
 */

let pathname = '/en';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const HEADER = readFileSync(join(__dirname, 'site-header.tsx'), 'utf8');
const SOURCES = ['competitions-bar.tsx', 'competitions-bar-links.tsx', 'competitions-directory.tsx']
  .map((file) => readFileSync(join(__dirname, file), 'utf8'))
  .join('\n');

const ITEMS = [
  { id: 'pgpl', label: 'Pro League', icon: null },
  { id: 'epl', label: 'PL', icon: null },
];

const bar = (locale: 'en' | 'fa', items = ITEMS) =>
  renderToStaticMarkup(
    <CompetitionsBarLinks
      locale={locale}
      items={items}
      all={message(locale, 'competitions.bar.all')}
      navLabel={attribute(locale, 'competitions.bar.label')}
    />,
  );

beforeEach(() => {
  pathname = '/en';
});

describe('the competitions bar', () => {
  it('is a named landmark: each competition to its page, then All competitions (T-1513)', () => {
    const html = bar('en');
    expect(html).toMatch(/<nav aria-label="Competitions"/);
    expect([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual([
      '/en/competition/pgpl',
      '/en/competition/epl',
      '/en/competitions',
    ]);
    expect(html).toContain('All competitions');
    expect(html).not.toContain('aria-current');
  });

  it('marks the competition being read, on any of its tabs', () => {
    pathname = '/en/competition/epl/';
    expect(isCompetitionPath('/en/competition/epl', 'en', 'epl')).toBe(true);
    expect(isCompetitionPath('/en/competition/epl2', 'en', 'epl')).toBe(false);
    const html = bar('en');
    expect(html).toMatch(/aria-current="page"[^>]*data-competition="epl"/);
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });

  it('marks All competitions on its page', () => {
    pathname = '/en/competitions';
    expect(bar('en')).toMatch(/aria-current="page"[^>]*data-testid="competitions-bar-all"/);
  });

  it('is in Persian on /fa', () => {
    pathname = '/fa';
    const html = bar('fa');
    expect(html).toContain('aria-label="رقابت‌ها"');
    expect(html).toContain('همه رقابت‌ها');
    expect(html).not.toContain('data-translation="untranslated"');
  });

  it('is All competitions alone when no list could be read (rule 3)', () => {
    const html = bar('en', []);
    expect(html.match(/<li/g)).toHaveLength(1);
    expect(html).toContain('/en/competitions');
  });

  it('draws the Design System pills, and is not drawn on a phone (D-267)', () => {
    const html = bar('en');
    const nav = /<nav[^>]*>/.exec(html)?.[0] ?? '';
    expect(nav).toContain('max-md:hidden');
    expect(nav).not.toContain('data-mode');
    expect(html.match(/class="pill-entry focus-inset"/g)).toHaveLength(2);
    expect(html).toContain('class="pill-all focus-inset"');
    // The arrow turns with the writing direction, and a screen reader skips it.
    expect(html).toContain(
      '<span aria-hidden="true" class="inline-block rtl:-scale-x-100">→</span>',
    );
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/@utility pill-entry \{[\s\S]*?rounded-pill border border-default/);
    expect(css).toMatch(/&\[aria-current='page'\] > span \{\s*@apply border-accent/);
  });

  it('sits right under the header, before the live strip', () => {
    const header = HEADER.indexOf('</header>');
    const bar = HEADER.indexOf('<CompetitionsBar');
    expect(header).toBeGreaterThan(0);
    expect(bar).toBeGreaterThan(header);
    expect(bar).toBeLessThan(HEADER.indexOf('<LiveStrip'));
  });

  it("keeps the contracts package off every page's first load (T-808)", () => {
    // The client halves draw logos the server rendered; EntityImage imports
    // @fmip/contracts, which would ride on every page's first load.
    for (const file of ['competitions-bar-links.tsx', 'competitions-directory.tsx']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).not.toMatch(/from '@\/components\/entity-image'/);
      expect(source).not.toMatch(/^import \{[^}]*\} from '@fmip\/contracts'/m);
    }
  });

  it('uses logical properties only (rule 7)', () => {
    expect(SOURCES).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-[\w[]/);
    expect(SOURCES).not.toMatch(/text-(?:left|right)\b/);
  });
});

describe('the All competitions list', () => {
  const pgpl = {
    id: 'pgpl',
    name: 'لیگ برتر خلیج فارس',
    short_name: null,
    scope: 'domestic' as const,
    kind: 'league' as const,
    country: { id: 'irn', name: 'ایران', code: 'IRN' },
    order: 1,
    logo: NO_MEDIA,
    season: '۲۰۲۵/۲۶',
  };
  const groups = [
    {
      key: 'continental',
      kind: 'continental' as const,
      name: null,
      code: null,
      heading: 'قاره‌ای',
      count: plural('fa', 'competitions.count', 1),
      competitions: [
        {
          id: 'ucl',
          name: 'لیگ قهرمانان اروپا',
          short_name: null,
          scope: 'continental' as const,
          kind: 'cup' as const,
          country: null,
          order: null,
          logo: NO_MEDIA,
          season: null,
        },
      ],
    },
    {
      key: 'irn',
      kind: 'country' as const,
      name: 'ایران',
      code: 'IRN',
      heading: 'ایران',
      count: plural('fa', 'competitions.count', 1),
      competitions: [pgpl],
    },
  ];
  const words = {
    filter: attribute('fa', 'competitions.filter'),
    jump: attribute('fa', 'competitions.jump'),
    noMatch: message('fa', 'competitions.noMatch'),
    all: message('fa', 'competitions.region.all'),
    allCount: plural('fa', 'competitions.count', 2),
  };
  const draw = (initialFilter = '', initialGroup: string | null = null) =>
    renderToStaticMarkup(
      <CompetitionsDirectory
        locale="fa"
        groups={groups}
        marks={{}}
        minis={{}}
        logos={{}}
        kinds={{ league: message('fa', 'competitionPage.kind.league') }}
        initialFilter={initialFilter}
        initialGroup={initialGroup}
        words={words}
      />,
    );
  const tiles = (html: string) =>
    [...html.matchAll(/<a[^>]*data-testid="competitions-region"[^>]*>/g)].map((m) => m[0]);
  const regionOf = (a: string) => /data-region="([^"]+)"/.exec(a)?.[1];

  it('draws each group as a section with its heading, and a card per competition', () => {
    const html = draw();
    expect(html.match(/data-testid="competitions-group"/g)).toHaveLength(2);
    expect(html).toContain('href="/fa/competition/pgpl"');
    expect(html).toContain('aria-labelledby="group-irn-heading"');
    // The card names the kind and the current season, in Persian digits.
    expect(html).toContain('۲۰۲۵/۲۶');
    expect(html).toContain('۱ رقابت');
    // The filter is labelled and is a plain GET form a reader without a script can send.
    expect(html).toContain('جست‌وجوی رقابت یا کشور');
    const form = /<form[^>]*>/.exec(html)?.[0] ?? '';
    expect(form).toContain('role="search"');
    expect(form).toContain('method="get"');
    expect(form).toContain('action="/fa/competitions"');
  });

  it('offers All, then a tile per group, each a link to its address (T-1612)', () => {
    const html = draw();
    const links = tiles(html);
    expect(links.map(regionOf)).toEqual(['all', 'continental', 'irn']);
    expect(links[0]).toContain('href="/fa/competitions"');
    expect(links[0]).toContain('aria-current="true"');
    expect(links[1]).toContain('href="/fa/competitions?country=continental"');
    expect(links[2]).toContain('href="/fa/competitions?country=irn"');
    expect(links.slice(1).some((a) => a.includes('aria-current'))).toBe(false);
    expect(html).toContain('همه');
    expect(html).toContain('۲ رقابت');
  });

  it('shows only the chosen group, marks its tile, and keeps the choice in the form', () => {
    const html = draw('', 'irn');
    expect(html.match(/data-testid="competitions-group"/g)).toHaveLength(1);
    expect(html).toContain('id="group-irn"');
    const links = tiles(html);
    expect(links.find((a) => regionOf(a) === 'irn')).toContain('aria-current="true"');
    expect(links.find((a) => regionOf(a) === 'all')).not.toContain('aria-current');
    // Not by colour alone: the chosen tile carries a check.
    expect(html.match(/data-testid="competitions-region-check"/g)).toHaveLength(1);
    expect(html).toMatch(/<input type="hidden" name="country" value="irn"\/>/);
  });

  it('combines the choice with the filter, and keeps the chosen tile when nothing matches', () => {
    const one = draw('ايران');
    expect(one.match(/data-testid="competitions-item"/g)).toHaveLength(1);
    expect(one).toContain('/fa/competition/pgpl');
    // Tiles keep the filter in their address, and only groups with a match stay.
    const links = tiles(one);
    expect(links.map(regionOf)).toEqual(['all', 'irn']);
    expect(links[1]).toContain('href="/fa/competitions?country=irn&amp;q=');

    const none = draw('zzz', 'continental');
    expect(none).toContain('data-testid="competitions-no-match"');
    expect(none).not.toContain('data-testid="competitions-group"');
    expect(tiles(none).map(regionOf)).toEqual(['all', 'continental']);
  });
});
