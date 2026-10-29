import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NO_MEDIA } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { attribute, message, plural } from '@/i18n/messages';
import { CompetitionsDirectory } from './competitions-directory';

/**
 * The All competitions page's list (T-1433, T-1612), drawn: the groups, the
 * chooser's tiles, the filter, the words in Persian, and only logical CSS.
 * The competitions bar it once shared this spec with is the matchday rail
 * now (T-1624), and the moments rail since T-1642 (`moments-rail.spec.tsx`).
 */

const SOURCE = readFileSync(join(__dirname, 'competitions-directory.tsx'), 'utf8');

it('uses logical properties only (rule 7)', () => {
  expect(SOURCE).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-[\w[]/);
  expect(SOURCE).not.toMatch(/text-(?:left|right)\b/);
});

it("keeps the contracts package off every page's first load (T-808)", () => {
  // The client half draws logos the server rendered; EntityImage imports
  // @fmip/contracts, which would ride on every page's first load.
  expect(SOURCE).not.toMatch(/from '@\/components\/entity-image'/);
  expect(SOURCE).not.toMatch(/^import \{[^}]*\} from '@fmip\/contracts'/m);
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
