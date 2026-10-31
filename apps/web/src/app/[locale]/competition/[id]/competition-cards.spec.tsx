import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AccuracyPoint,
  CompetitionPage,
  LeagueZone,
  LeagueZones,
  SeasonFixture,
  TableRow,
} from '@fmip/contracts';
import { STALE_LIVE_AFTER_MS } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ZoneLegend } from '@/components/competition-page';
import { message } from '@/i18n/messages';
import { type CompetitionTab, type LeagueModel, seasonRounds } from '@/lib/competition-overview';
import type { CardForecast } from '@/lib/score-card-products';
import {
  MatchLine,
  MatchweekCard,
  ModelCard,
  ModelFigures,
  ModelMonths,
  ResultsCard,
  TableCard,
  roundTitle,
} from './competition-cards';
import { CompetitionHeader } from './competition-header';

/**
 * The competition page in the Stadiomind design (T-1498, D-274): the header
 * and its tabs, the full table whose places carry a zone colour only where
 * the feed lists them, a day of matches with the model's percentages or the
 * words for why not, and the model in this league with its coverage badge.
 * Every state is said, none is drawn as if it had data (rule 3).
 */

const ID = '00000000-0000-4000-8000-000000000201';
const TABS: CompetitionTab[] = ['overview', 'table', 'matches', 'players', 'model', 'news'];
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

function fixture(over: Partial<SeasonFixture> = {}): SeasonFixture {
  return {
    id: '00000000-0000-4000-8000-00000000f001',
    kickoff_at: '2026-10-25T14:00:00.000Z',
    status: 'scheduled',
    round: 'Regular Season - 9',
    stage: null,
    home: { id: 'h', name: 'Liverpool', short_name: null },
    away: { id: 'a', name: 'Brighton', short_name: null },
    score: null,
    ...over,
  };
}

const row = (id: string, position: number, form: TableRow['form']): TableRow => ({
  position,
  team: { id, name: `Team ${id}`, short_name: null },
  played: 8,
  won: 7,
  drawn: 0,
  lost: 1,
  goals_for: 20,
  goals_against: 9,
  goal_difference: position === 1 ? 11 : -3,
  points: 21,
  form,
});

function page(over: Partial<CompetitionPage> = {}): CompetitionPage {
  return {
    competition: {
      id: ID,
      name: 'Premier League',
      localised_name: null,
      short_name: 'Premier League',
      kind: 'league',
      scope: 'domestic',
      gender: 'men',
      age_group: 'senior',
      tier: 1,
      country: { id: 'gb-eng', name: 'England', code: 'GB-ENG' },
    },
    seasons: [
      {
        id: 's2',
        label: '2026/27',
        start_date: '2026-08-01',
        end_date: '2027-05-30',
        is_current: true,
      },
      {
        id: 's1',
        label: '2025/26',
        start_date: '2025-08-01',
        end_date: '2026-05-30',
        is_current: false,
      },
    ],
    season: {
      id: 's2',
      label: '2026/27',
      start_date: '2026-08-01',
      end_date: '2027-05-30',
      is_current: true,
      stages: [],
    },
    table: {
      coverage: 'available',
      last_updated_at: '2026-10-24T18:25:00.000Z',
      data: [row('a', 1, ['L', 'W', 'W', 'W', 'W']), row('b', 18, ['D'])],
    },
    group_tables: null,
    conference_tables: null,
    zones: { state: 'not_listed', reason: 'season_not_listed' },
    results: [],
    fixtures: [fixture()],
    leaders: { coverage: 'limited', last_updated_at: null, data: [] },
    leaders_filter: { min_minutes: null, unproven: 0, presets: [450, 900, 1800] },
    boards: {
      assists: { coverage: 'not_supplied', last_updated_at: null, data: null },
      clean_sheets: { coverage: 'not_supplied', last_updated_at: null, data: null },
      yellow_cards: { coverage: 'not_supplied', last_updated_at: null, data: null },
      red_cards: { coverage: 'not_supplied', last_updated_at: null, data: null },
      unproven: { assists: 0, clean_sheets: 0, yellow_cards: 0, red_cards: 0 },
    },
    leaders_source: 'recorded',
    bracket: null,
    coverage: { standings: 'available', lineups: 'limited', scores: 'delayed' },
    last_updated_at: '2026-10-25T13:59:00.000Z',
    ...over,
  } as CompetitionPage;
}

/** A model version written as one run, which Cloudflare's Email Obfuscation rewrites (T-1580). */
const ADDRESS = /\S+@\d+\.\d+\.\d+/;
const SOURCE = readFileSync(join(__dirname, 'competition-cards.tsx'), 'utf8');
/** The words a reader sees and a screen reader reads: the markup taken away. */
const text = (html: string) => html.replace(/<[^>]+>/g, '');

const header = (p: CompetitionPage, locale = 'en', tab: CompetitionTab = 'overview') =>
  renderToStaticMarkup(
    <CompetitionHeader
      page={p}
      locale={locale}
      tab={tab}
      tabs={TABS}
      minMinutes={null}
      matchweek={{ label: 'Matchweek 9', state: 'next', fixtures: [], more: 0 }}
      follow={null}
    />,
  );

describe('the header and the section tabs', () => {
  it('says the country, season, clubs and round, and marks the open tab in saffron', () => {
    const html = header(page());
    expect(html).toContain('data-testid="title"');
    expect(html).toMatch(/England.*2026\/27.*2 clubs.*Matchweek 9/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*data-testid="competition-tab-overview"/);
    expect(html).toMatch(/data-testid="competition-tab-overview"[^>]*border-accent/);
    expect(html).toContain(`href="/en/competition/${ID}?tab=model"`);
    for (const label of ['Overview', 'Table', 'Matches', 'Players', 'News'])
      expect(html).toContain(`>${label}</a>`);
    // The phone board's short "Model", the full name from sm up (T-1558).
    expect(html).toContain('<span class="sm:hidden">Model</span>');
    expect(html).toContain('<span class="hidden sm:inline">Model in this league</span>');
  });

  it('opens the sideways-scrolling tabs at the current one on a phone (T-1558)', () => {
    const html = header(page(), 'en', 'news');
    expect(html.match(/scroll-initial-target:nearest/g)).toHaveLength(1);
    expect(html).toMatch(
      /aria-current="page"[^>]*data-testid="competition-tab-news"[^>]*scroll-initial-target/,
    );
  });

  it('keeps the open tab in every season’s link, and leads a phone back to the leagues', () => {
    const html = header(page(), 'en', 'table');
    expect(html).toContain('data-testid="seasons"');
    expect(html).toContain(`href="/en/competition/${ID}?season=s1&amp;tab=table"`);
    expect(html).toContain('href="/en/competitions"');
    expect(html).toContain('aria-label="Back to all competitions"');
  });

  it('shows one season as a label, not a menu', () => {
    const html = header(page({ seasons: page().seasons.slice(0, 1) }));
    expect(html).toContain('data-testid="season-label"');
    expect(html).not.toContain('<details');
  });

  it('calls the table tab the knockout rounds for a cup with no table', () => {
    const cup = page({
      competition: { ...page().competition, kind: 'cup' },
      table: { coverage: 'not_supplied', last_updated_at: null, data: [] },
    });
    expect(header(cup)).toContain('Knockout rounds');
  });

  it('is in Persian with Persian digits on /fa, the back chevron mirrored', () => {
    const html = header(page(), 'fa');
    expect(html).toContain('۲۰۲۶/۲۷');
    expect(html).toContain('۲ باشگاه');
    expect(html).toContain('مدل در این لیگ');
    expect(html).not.toMatch(/2026\/27/);
    expect(html).toContain('rtl:-scale-x-100');
  });
});

describe('the table', () => {
  const listed: LeagueZones = {
    state: 'listed',
    teams: 20,
    zones: [
      { kind: 'champions_league', from: 1, to: 4 },
      { kind: 'relegation', from: 18, to: 20 },
    ],
    sources: ['https://example.org/rules'],
    complete: true,
    note: null,
  };

  it('draws no zone colour where the feed does not list the places, and says so', () => {
    const html = renderToStaticMarkup(<TableCard page={page()} locale="en" timeZone="UTC" />);
    expect(html).not.toContain('data-zone=');
    expect(html).not.toMatch(/border-s-(accent|danger|warning)/);
    expect(html).toContain('data-testid="table-zones-absent"');
    expect(html).toContain('data-coverage-badge="available"');
  });

  it('marks each listed place on its start edge, named for a screen reader', () => {
    const html = renderToStaticMarkup(
      <TableCard page={page({ zones: listed })} locale="en" timeZone="UTC" />,
    );
    expect(html).toContain('data-zone="champions_league"');
    expect(html).toContain('data-zone="relegation"');
    expect(html).toContain('data-testid="table-zones"');
    expect(html).toContain('(Champions League)');
  });

  it('writes the goals as one pair and the form in letters, most recent first', () => {
    const html = renderToStaticMarkup(<TableCard page={page()} locale="en" timeZone="UTC" />);
    expect(html).toContain('>20:9<');
    expect(html).toContain('+11');
    expect(html).toContain('−3');
    const form = html.slice(html.indexOf('data-testid="form"'));
    expect(
      [...form.slice(0, form.indexOf('sr-only')).matchAll(/data-result="(\w)"/g)].map((m) => m[1]),
    ).toEqual(['L', 'W', 'W', 'W', 'W']);
    expect(html).toContain('most recent first');
    expect(html).toContain('<caption class="sr-only">Premier League table</caption>');
  });

  it('says the table is not supplied rather than drawing an empty grid', () => {
    const html = renderToStaticMarkup(
      <TableCard
        page={page({ table: { coverage: 'not_supplied', last_updated_at: null, data: null } })}
        locale="en"
        timeZone="UTC"
      />,
    );
    expect(html).toContain('data-testid="table-empty"');
    expect(html).not.toContain('<table');
    expect(html).toContain('data-coverage-badge="not_supplied"');
  });

  it('is the overall table beside conference tables (T-1672), in English and Persian', () => {
    const plain = renderToStaticMarkup(<TableCard page={page()} locale="en" timeZone="UTC" />);
    expect(plain).not.toContain('Overall table');
    const en = renderToStaticMarkup(<TableCard page={page()} locale="en" timeZone="UTC" overall />);
    expect(en).toContain('Overall table');
    const fa = renderToStaticMarkup(<TableCard page={page()} locale="fa" timeZone="UTC" overall />);
    expect(fa).toContain('جدول کلی');
  });

  describe('a league whose places are its conferences’ (T-1674, D-323)', () => {
    const mls = (zones: LeagueZone[]): LeagueZones => ({
      state: 'listed',
      teams: 30,
      zones,
      complete: true,
      sources: ['https://www.mlssoccer.com/news/audi-2026-mls-cup-playoffs-format-how-it-works'],
      note: 'Clubs level on points are ranked by wins.',
      note_fa: 'تیم‌های هم‌امتیاز به ترتیب تعداد برد رده‌بندی می‌شوند.',
    });
    const both = mls(
      ['Eastern Conference', 'Western Conference'].flatMap((conference) => [
        { kind: 'title_playoffs' as const, from: 1, to: 7, conference },
        { kind: 'title_playoffs_wild_card' as const, from: 8, to: 9, conference },
      ]),
    );

    it('marks nothing on the overall table, which leaves the legend to the conference tables', () => {
      const html = renderToStaticMarkup(
        <TableCard page={page({ zones: both })} locale="en" timeZone="UTC" overall />,
      );
      expect(html).not.toContain('data-zone=');
      expect(html).not.toContain('data-testid="table-zones"');
      expect(html).not.toContain('table-zones-absent');
      expect(html).toContain('data-testid="form-order"');
    });

    it('lists each band of the conference tables once, without the cup-winners line', () => {
      const html = renderToStaticMarkup(
        <ZoneLegend locale="en" zones={both} tables="conferences" />,
      );
      expect(html).toContain('data-testid="conference-zones"');
      expect(html.match(/<li /g)).toHaveLength(2);
      expect(html).toContain('Play-offs: 1');
      expect(html).toContain('Play-off wild-card round: 8');
      expect(html).not.toContain('Europa');
      expect(html).toContain('Clubs level on points are ranked by wins.');
      expect(html).toContain('border-s-accent');
      expect(html).toContain('border-s-strong');
    });

    it('names the conference where the conferences’ bands differ', () => {
      const html = renderToStaticMarkup(
        <ZoneLegend
          locale="en"
          zones={mls([
            { kind: 'title_playoffs', from: 1, to: 7, conference: 'Eastern Conference' },
            { kind: 'title_playoffs', from: 1, to: 6, conference: 'Western Conference' },
          ])}
          tables="conferences"
        />,
      );
      expect(html).toContain('Eastern Conference, Play-offs: 1');
      expect(html).toContain('Western Conference, Play-offs: 1');
    });

    it('says it in Persian, and nothing for a league without conference places', () => {
      const fa = renderToStaticMarkup(<ZoneLegend locale="fa" zones={both} tables="conferences" />);
      expect(fa).toContain('پلی‌آف قهرمانی');
      expect(fa).toContain('دور وایلدکارت پلی‌آف');
      expect(fa).toContain('تیم‌های هم‌امتیاز');
      expect(
        renderToStaticMarkup(<ZoneLegend locale="en" zones={listed} tables="conferences" />),
      ).toBe('');
      expect(
        renderToStaticMarkup(
          <ZoneLegend
            locale="en"
            zones={{ state: 'not_listed', reason: 'season_not_listed' }}
            tables="conferences"
          />,
        ),
      ).toBe('');
    });
  });

  it('writes the table in Persian digits on /fa', () => {
    const html = renderToStaticMarkup(<TableCard page={page()} locale="fa" timeZone="UTC" />);
    expect(html).toContain('>۲۱<');
    expect(html).toContain('+۱۱');
  });

  it('gives the league’s note in Persian on /fa, and marks the English one elsewhere (T-1557)', () => {
    const noted: LeagueZones = {
      ...listed,
      note: 'A tie on points for first place is settled by a play-off.',
      note_fa: 'اگر دو تیم برای مقام اول هم‌امتیاز شوند، قهرمان در یک دیدار پلی‌آف تعیین می‌شود.',
    };
    const at = (locale: string) =>
      renderToStaticMarkup(
        <TableCard page={page({ zones: noted })} locale={locale} timeZone="UTC" />,
      );
    const fa = at('fa');
    expect(fa).toContain('<p data-testid="table-zones-note">اگر دو تیم');
    expect(fa).not.toContain('settled by a play-off');
    expect(at('en')).toContain('<p data-testid="table-zones-note">A tie on points');
    // A language with no translation keeps the English, said to be English.
    expect(at('de')).toContain('<p data-testid="table-zones-note" lang="en" dir="ltr">A tie');
  });

  it('sets each form letter apart, so Persian letters never join into a word (T-1557)', () => {
    const html = renderToStaticMarkup(<TableCard page={page()} locale="fa" timeZone="UTC" />);
    const form = html.slice(html.indexOf('data-testid="form"'));
    expect(form).toMatch(
      /^data-testid="form"><span aria-hidden="true" class="inline-flex gap-\[0.2em\]">/,
    );
    expect(form).toMatch(/<span data-result="L">ش<\/span><span data-result="W">ب<\/span>/);
  });
});

const available: CardForecast = {
  state: 'available',
  home: 48.2,
  draw: 24.9,
  away: 26.9,
  version: 3,
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: '2026-10-25T08:00:00.000Z',
};

describe('a match row', () => {
  it("puts each side's crest before its name, and the mark where none is held (T-1617)", () => {
    const html = renderToStaticMarkup(
      <ul>
        <MatchLine
          fixture={fixture({
            status: 'finished',
            score: { home: 2, away: 1 },
            home: {
              ...fixture().home,
              crest: { coverage: 'available', url: '/api/media/crest/h/0123456789ab.png' },
            },
            away: { ...fixture().away, crest: { coverage: 'not_supplied', url: null } },
          })}
          locale="en"
          timeZone="UTC"
        />
      </ul>,
    );
    // Home crest, home name, score, away mark, away name: in that order.
    expect(html).toMatch(
      /<img[^>]*src="\/api\/media\/crest\/h\/0123456789ab-48\.webp".*Liverpool.*2–1.*data-letters="B".*Brighton/,
    );
    expect(html).not.toMatch(PHYSICAL);
  });

  it('keeps the score between the sides, home first, in the page’s direction', () => {
    const done = fixture({ status: 'finished', score: { home: 2, away: 1 } });
    const en = renderToStaticMarkup(
      <ul>
        <MatchLine fixture={done} locale="en" timeZone="UTC" />
      </ul>,
    );
    expect(en).toMatch(/Liverpool.*data-testid="fixture-score">2–1<.*Brighton/);
    expect(en).toContain('>FT<');
    expect(en).toContain(`href="/en/match/${done.id}"`);
    const fa = renderToStaticMarkup(
      <ul>
        <MatchLine fixture={done} locale="fa" timeZone="UTC" />
      </ul>,
    );
    expect(fa).toMatch(/Liverpool.*dir="rtl"[^>]*data-testid="fixture-score">۲–۱<.*Brighton/);
  });

  it('lets a long name wrap rather than cutting it short (T-1555)', () => {
    const long = fixture({
      home: { ...fixture().home, name: 'Nottingham Forest', short_name: null },
      away: { ...fixture().away, name: 'Wolverhampton Wanderers', short_name: null },
    });
    const html = renderToStaticMarkup(
      <ul>
        <MatchLine fixture={long} locale="en" timeZone="UTC" forecast={available} />
      </ul>,
    );
    expect(html).toContain('Nottingham Forest');
    expect(html).toContain('Wolverhampton Wanderers');
    expect(html).not.toContain('truncate');
    expect(html).toMatch(/data-testid="fixture-teams"/);
    expect(html).toMatch(/class="[^"]*break-words[^"]*"[^>]*data-testid="fixture-teams"/);
  });

  it('says a postponed match is postponed and a live one is live', () => {
    const html = renderToStaticMarkup(
      <ul>
        <MatchLine fixture={fixture({ status: 'postponed' })} locale="en" timeZone="UTC" />
        <MatchLine
          fixture={fixture({ id: 'x', status: 'live', score: { home: 1, away: 1 } })}
          locale="en"
          timeZone="UTC"
        />
      </ul>,
    );
    expect(html).toContain('postponed');
    expect(html).toMatch(/text-live[^>]*>live</);
  });

  it('gives the model’s three percentages whole, and words when there are none', () => {
    const html = renderToStaticMarkup(<ModelFigures locale="en" forecast={available} />);
    expect(html).toContain('48 · 25 · 27');
    expect(html).toContain('The model: home win 48%, draw 25%, away win 27%');
    expect(html).toContain('text-model');
    expect(
      renderToStaticMarkup(<ModelFigures locale="en" forecast={{ state: 'none' }} />),
    ).toContain('No forecast');
    const unavailable = renderToStaticMarkup(
      <ModelFigures
        locale="en"
        forecast={{
          state: 'unavailable',
          reason: null,
          version: 1,
          computed_at: available.computed_at,
        }}
      />,
    );
    expect(unavailable).toContain('data-forecast="unavailable"');
    expect(unavailable).toContain('No forecast');
    expect(
      renderToStaticMarkup(<ModelFigures locale="en" forecast={{ state: 'unreachable' }} />),
    ).toContain('Forecast not loaded');
    expect(renderToStaticMarkup(<ModelFigures locale="fa" forecast={available} />)).toContain(
      '۴۸ · ۲۵ · ۲۷',
    );
  });

  it('prints whole percentages that total 100, never 101 (blueprint 6.2, T-1555)', () => {
    const html = renderToStaticMarkup(
      <ModelFigures locale="en" forecast={{ ...available, home: 40.6, draw: 28.9, away: 30.5 }} />,
    );
    expect(html).toContain('40 · 29 · 31');
    expect(html).toContain('home win 40%, draw 29%, away win 31%');
  });
});

describe('a round’s matches (T-1636)', () => {
  const words = {
    'freshness.checked': message('en', 'freshness.checked'),
    'freshness.behind': message('en', 'freshness.behind'),
  };
  const now = Date.parse('2026-10-25T14:30:00.000Z');
  const ROUND_9 = [
    fixture({
      id: 'f1',
      kickoff_at: '2026-10-24T14:00:00.000Z',
      status: 'finished',
      score: { home: 3, away: 1 },
    }),
    fixture(),
    fixture({
      id: 'f3',
      kickoff_at: '2026-10-26T20:00:00.000Z',
      home: { id: 'u', name: 'Man United', short_name: null },
    }),
  ];
  const ROUND_10 = [
    fixture({ id: 'g1', round: 'Regular Season - 10', kickoff_at: '2026-10-31T15:00:00.000Z' }),
  ];
  const ROUND_8 = [
    fixture({
      id: 'e1',
      round: 'Regular Season - 8',
      kickoff_at: '2026-10-18T14:00:00.000Z',
      status: 'finished',
      score: { home: 0, away: 0 },
    }),
  ];
  const season = page({
    results: [ROUND_9[0]!, ...ROUND_8].reverse(),
    fixtures: [ROUND_9[1]!, ROUND_9[2]!, ...ROUND_10],
  });
  const href = (n: number) => `/en/competition/${ID}?round=${n}#match-day`;
  const card = (
    locale: string,
    shown: number | null,
    over: { forecasts?: Record<string, CardForecast>; at?: number; zone?: string } = {},
  ) => {
    const zone = over.zone ?? 'Europe/London';
    const rounds = seasonRounds(locale, season, zone);
    return renderToStaticMarkup(
      <MatchweekCard
        rounds={rounds}
        round={shown === null ? null : rounds[shown - 1]!}
        href={href}
        forecasts={over.forecasts ?? {}}
        page={season}
        locale={locale}
        timeZone={zone}
        now={over.at ?? now}
        freshnessWords={words}
      />,
    );
  };

  it('names the round, lists every match under its day, with the model’s figures or why not', () => {
    const html = card('en', 2, { forecasts: { [fixture().id]: available } });
    expect(html).toContain('data-testid="round-title">Matchweek 9<');
    expect(html.match(/data-testid="round-day"/g)).toHaveLength(3);
    expect(text(html)).toContain('Saturday 24 October');
    expect(text(html)).toContain('Monday 26 October');
    expect(html.match(/data-testid="fixture"/g)).toHaveLength(3);
    // A result with its score, a match to come at its kick-off in the reader's zone.
    expect(html).toContain('data-testid="fixture-score"');
    expect(text(html)).toContain('20:00');
    expect(html).toContain('data-forecast="available"');
    expect(html).toContain('data-forecast="none"');
    // The version as the reader sees it, never one run an obfuscator reads as an address (T-1580).
    expect(text(html)).toContain('(dixon-coles-elo@0.6.0)');
    expect(html).not.toMatch(ADDRESS);
    expect(html).toContain('UK time');
    expect(html).toContain('model %');
    expect(html).not.toContain('data-freshness');
  });

  /** Every opening tag carrying `data-testid="<id>"`. */
  const tags = (html: string, id: string) =>
    [...html.matchAll(new RegExp(`<(?:a|span) [^>]*data-testid="${id}"[^>]*>`, 'g'))].map(
      (m) => m[0],
    );

  it('steps to the round before and after, and lists every round with the shown one current', () => {
    const html = card('en', 2);
    const [prev] = tags(html, 'round-prev');
    expect(prev).toMatch(/^<a /);
    expect(prev).toContain(`href="/en/competition/${ID}?round=1#match-day"`);
    expect(prev).toContain('rel="prev"');
    expect(prev).toContain('aria-label="Previous: Matchweek 8"');
    const [next] = tags(html, 'round-next');
    expect(next).toContain(`href="/en/competition/${ID}?round=3#match-day"`);
    expect(next).toContain('rel="next"');
    expect(next).toContain('aria-label="Next: Matchweek 10"');
    expect(html).toContain('<nav aria-label="Rounds"');
    expect(html).toContain('All rounds');
    expect(html).toContain('data-testid="round-position">2 of 3<');
    const options = tags(html, 'round-option');
    expect(options).toHaveLength(3);
    expect(options.filter((tag) => tag.includes('aria-current="true"'))).toEqual([
      expect.stringContaining('?round=2#match-day'),
    ]);
  });

  it('has nothing to step to before the first round or after the last', () => {
    const first = card('en', 1);
    expect(tags(first, 'round-prev')[0]).toMatch(/^<span [^>]*aria-hidden="true"/);
    expect(tags(first, 'round-next')[0]).toMatch(/^<a /);
    const last = card('en', 3);
    expect(tags(last, 'round-next')[0]).toMatch(/^<span [^>]*aria-hidden="true"/);
  });

  it('is in Persian on /fa: the round, its days and its numbers in Persian digits', () => {
    const html = card('fa', 2, { zone: 'Asia/Tehran' });
    expect(html).toContain('data-testid="round-title">هفته‌ی ۹<');
    expect(html).toContain('aria-label="قبلی: هفته‌ی ۸"');
    expect(html).toContain('aria-label="بعدی: هفته‌ی ۱۰"');
    expect(html).toContain('همه‌ی دورها');
    expect(html).toContain('data-testid="round-position">۲ از ۳<');
    expect(text(html)).not.toMatch(/[0-9]/);
    expect(html).not.toContain('data-translation="untranslated"');
  });

  it('keeps the page’s scroll on a step, and uses logical properties only (rule 7)', () => {
    const html = card('en', 2);
    expect(html).not.toMatch(PHYSICAL);
    expect(SOURCE).toMatch(/scroll=\{false\}/);
  });

  it('stamps its freshness while a match is live, and says when it may be behind', () => {
    const live = fixture({ status: 'live', score: { home: 0, away: 0 } });
    const rounds = seasonRounds('en', { results: [], fixtures: [live] }, 'UTC');
    const render = (at: number) =>
      renderToStaticMarkup(
        <MatchweekCard
          rounds={rounds}
          round={rounds[0]!}
          href={href}
          forecasts={{}}
          page={page()}
          locale="en"
          timeZone="UTC"
          now={at}
          freshnessWords={words}
        />,
      );
    expect(render(Date.parse(page().last_updated_at!) + 10_000)).toContain(
      'data-freshness="current"',
    );
    expect(render(Date.parse(page().last_updated_at!) + STALE_LIVE_AFTER_MS + 1)).toContain(
      'data-freshness="behind"',
    );
  });

  it('says nothing is left to play rather than drawing an empty round', () => {
    const html = card('en', null);
    expect(html).toContain('data-testid="match-day-empty"');
    expect(html).not.toContain('data-testid="fixture"');
    expect(html).not.toContain('round-picker');
  });

  it('names a round it cannot name by its dates, never by the feed’s words (D-193)', () => {
    const odd = fixture({ round: 'Apertura Fase Final', kickoff_at: '2026-10-25T14:00:00.000Z' });
    const later = fixture({
      id: 'o2',
      round: 'Apertura Fase Final',
      kickoff_at: '2026-10-27T19:00:00.000Z',
    });
    const rounds = seasonRounds('en', { results: [], fixtures: [odd, later] }, 'UTC');
    expect(roundTitle('en', rounds[0]!, 'UTC')).toBe('25 Oct – 27 Oct');
    const html = renderToStaticMarkup(
      <MatchweekCard
        rounds={rounds}
        round={rounds[0]!}
        href={href}
        forecasts={{}}
        page={page()}
        locale="en"
        timeZone="UTC"
        now={now}
        freshnessWords={words}
      />,
    );
    expect(html).not.toContain('Apertura');
  });

  it('lists the latest results, or says there are none', () => {
    const done = fixture({
      kickoff_at: '2026-10-24T14:00:00.000Z',
      status: 'finished',
      score: { home: 0, away: 2 },
    });
    const html = renderToStaticMarkup(
      <ResultsCard day={{ day: '2026-10-24', fixtures: [done] }} locale="en" timeZone="UTC" />,
    );
    expect(html).toContain('Results · Saturday 24 October');
    expect(html).toContain('>0–2<');
    expect(renderToStaticMarkup(<ResultsCard day={null} locale="en" timeZone="UTC" />)).toContain(
      'data-testid="results-day-empty"',
    );
  });
});

describe('the model in this league', () => {
  const point = (matches: number, over: Partial<AccuracyPoint> = {}): AccuracyPoint => ({
    period: '2026-10',
    period_start: '2026-10-01',
    forecasts: matches,
    matches,
    coverage: matches < 30 ? 'limited' : 'available',
    log_loss: 1.01,
    brier: 0.6,
    rps: 0.225,
    accuracy: 0.52,
    uniform_rps: 0.244,
    ...over,
  });
  const scored = (latest: AccuracyPoint): LeagueModel => ({
    state: 'scored',
    latest,
    months: [latest, point(31, { period: '2026-09', period_start: '2026-09-01' })],
    total: point(56),
    modelVersions: ['dixon-coles-elo@0.6.0'],
    lastUpdatedAt: '2026-10-25T06:00:00.000Z',
  });
  const card = (model: LeagueModel, locale = 'en', pastSeason = false) =>
    renderToStaticMarkup(
      <ModelCard
        model={model}
        locale={locale}
        timeZone="UTC"
        pastSeason={pastSeason}
        more={{
          href: `/${locale}/competition/${ID}?tab=model`,
          label: 'competitionPage.model.more',
        }}
      />,
    );

  it('gives the month’s figures with a limited badge and the reason below the minimum', () => {
    const html = card(scored(point(25)));
    expect(html).toContain('In this league · October 2026');
    expect(html).toContain('>52%<');
    expect(html).toContain('>0.225<');
    expect(html).toContain('RPS (0.244 guessing)');
    expect(html).toContain('>25<');
    expect(html).toContain('data-coverage-badge="limited"');
    expect(html).toContain('data-testid="league-model-limited"');
    expect(html).toContain('fewer than 30 matches');
    expect(html).toContain('MODEL');
  });

  it('is available from the minimum, with no limited sentence', () => {
    const html = card(scored(point(40)));
    expect(html).toContain('data-coverage-badge="available"');
    expect(html).not.toContain('data-testid="league-model-limited"');
  });

  it('shows no figure when nothing is scored, and says so with a not supplied badge', () => {
    const html = card({ state: 'not_supplied' });
    expect(html).toContain('data-testid="league-model-empty"');
    expect(html).toContain('data-coverage-badge="not_supplied"');
    expect(html).not.toContain('%<');
  });

  it('says of an older season that nothing in it was scored (T-1556)', () => {
    const html = card({ state: 'not_supplied' }, 'en', true);
    expect(html).toContain('in this season has been scored');
    expect(html).toContain('data-coverage-badge="not_supplied"');
    expect(card({ state: 'not_supplied' }, 'fa', true)).toContain('این فصل');
  });

  it('says the accuracy could not be loaded, with no badge pretending to know', () => {
    const html = card({ state: 'unreachable' });
    expect(html).toContain('data-testid="league-model-unreachable"');
    expect(html).not.toContain('data-coverage-badge');
  });

  it('is in Persian with Persian digits on /fa', () => {
    const html = card(scored(point(25)), 'fa');
    expect(html).toContain('۲۵');
    expect(html).toContain('۰٫۲۲۵');
    expect(html).not.toContain('0.225');
  });

  it('lists every month, newest first, then all of them, each with its coverage', () => {
    const html = renderToStaticMarkup(<ModelMonths model={scored(point(25))} locale="en" />);
    expect(html.match(/data-testid="league-model-month"/g)).toHaveLength(3);
    expect(html.indexOf('October 2026')).toBeLessThan(html.indexOf('September 2026'));
    expect(html).toContain('All months');
    expect(text(html)).toContain('Model versions: dixon-coles-elo@0.6.0.');
    expect(html).not.toMatch(ADDRESS);
    expect(html).toContain('not counted');
    // Wider than a phone: its own box a keyboard can reach and scroll (T-1558).
    expect(html).toMatch(
      /role="region" aria-labelledby="league-model-months-heading" tabindex="0"/,
    );
    expect(html).toContain('id="league-model-months-heading"');
    expect(
      renderToStaticMarkup(<ModelMonths model={{ state: 'not_supplied' }} locale="en" />),
    ).toBe('');
  });
});

describe('the page’s own files', () => {
  const read = (name: string) => readFileSync(join(__dirname, name), 'utf8');

  it('use logical properties only (rule 7) and no client code', () => {
    for (const name of ['page.tsx', 'competition-header.tsx', 'competition-cards.tsx']) {
      const source = read(name);
      expect(source, name).not.toMatch(PHYSICAL);
      expect(source, name).not.toContain("'use client'");
    }
  });

  it('ask the model for a list of matches in one request, never one per match', () => {
    const source = read('page.tsx');
    expect(source).toContain('fetchForecastSummaries(ids)');
    expect(source.match(/fetchForecastSummaries\(/g)).toHaveLength(1);
  });
});
