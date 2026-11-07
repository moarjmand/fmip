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
import {
  type CompetitionTab,
  type LeagueModel,
  type MatchView,
  matchList,
  seasonRounds,
} from '@/lib/competition-overview';
import type { CardForecast } from '@/lib/score-card-products';
import {
  MatchLine,
  MatchesTab,
  MatchweekCard,
  ModelCard,
  ModelMonths,
  ResultsCard,
  TableCard,
  TableMissingCard,
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

  it('hangs the season list from the start edge on a phone, the end edge from sm up (T-1706)', () => {
    for (const locale of ['en', 'fa']) {
      const html = header(page(), locale);
      const list = html.match(/<ul class="([^"]*)" data-testid="season-options"/);
      expect(list).not.toBeNull();
      const classes = (list?.[1] ?? '').split(' ');
      expect(classes).toEqual(expect.arrayContaining(['start-0', 'sm:start-auto', 'sm:end-0']));
      expect(classes).not.toContain('end-0');
      expect(classes.some((c) => /(^|:)(left|right)-/.test(c))).toBe(false);
    }
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
    unmarked_cup_places: true,
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

  it('says cup winners reassign the Europa and Conference League places only for a UEFA league (T-1674)', () => {
    const line = 'Cup winners change who takes the Europa and Conference League places';
    const european = renderToStaticMarkup(
      <TableCard page={page({ zones: listed })} locale="en" timeZone="UTC" />,
    );
    expect(european).toContain(line);
    // A Brasileirão-like entry: Libertadores places, no UEFA competition to speak of.
    const brazil: LeagueZones = {
      state: 'listed',
      teams: 20,
      zones: [
        { kind: 'copa_libertadores', from: 1, to: 4 },
        { kind: 'relegation', from: 17, to: 20 },
      ],
      sources: ['https://example.org/rules'],
      complete: false,
      note: null,
      unmarked_cup_places: false,
    };
    const html = renderToStaticMarkup(
      <TableCard page={page({ zones: brazil })} locale="en" timeZone="UTC" />,
    );
    expect(html).toContain('data-testid="table-zones"');
    expect(html).not.toContain('Europa');
    expect(html).toContain('Copa Libertadores');
    const fa = (zones: LeagueZones) =>
      renderToStaticMarkup(<TableCard page={page({ zones })} locale="fa" timeZone="UTC" />);
    const faLine = message('fa', 'competitionPage.zones.cupWinners').text;
    expect(fa(listed)).toContain(faLine);
    expect(fa(brazil)).not.toContain(faLine);
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
      unmarked_cup_places: false,
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

describe('a match row (T-1762, D-378: D-374’s row)', () => {
  /** Two hours before the kick-off of `fixture()`. */
  const before = Date.parse('2026-10-25T12:00:00.000Z');
  const line = (
    f: SeasonFixture,
    over: { forecast?: CardForecast; now?: number; locale?: string } = {},
  ) =>
    renderToStaticMarkup(
      <ul>
        <MatchLine
          fixture={f}
          locale={over.locale ?? 'en'}
          timeZone="UTC"
          forecast={over.forecast}
          now={over.now}
        />
      </ul>,
    );

  it("puts each side's crest before its name, and the mark where none is held (T-1617)", () => {
    const html = line(
      fixture({
        status: 'finished',
        score: { home: 2, away: 1 },
        home: {
          ...fixture().home,
          crest: { coverage: 'available', url: '/api/media/crest/h/0123456789ab.png' },
        },
        away: { ...fixture().away, crest: { coverage: 'not_supplied', url: null } },
      }),
    );
    // Home crest, home name, its goals; away mark, away name, its goals: in that order.
    expect(html).toMatch(
      /<img[^>]*src="\/api\/media\/crest\/h\/0123456789ab-48\.webp".*Liverpool.*data-testid="home-score"[^>]*>2<.*data-letters="B".*Brighton.*data-testid="away-score"[^>]*>1</,
    );
    expect(html).not.toMatch(PHYSICAL);
  });

  it('draws a match to come as the 72px row: the one bar in the end column, Pick under the time', () => {
    const html = line(fixture(), { forecast: available, now: before });
    expect(html).toMatch(/<li class="match-row" data-testid="fixture" data-status="scheduled"/);
    expect(html).not.toContain('match-row-done');
    // The one ForecastBar of D-368, never the old turquoise "48 · 25 · 27".
    expect(html.match(/data-testid="row-bar"/g)).toHaveLength(1);
    expect(html).toMatch(/data-testid="row-forecast" data-state="available"/);
    expect(html).toContain('col-start-3 row-span-2 row-start-1');
    expect(html).not.toContain('48 · 25 · 27');
    expect(text(html)).toContain('14:00');
    // Pick, to the match page's pick card, under the time.
    const [pick] = html.match(/<a [^>]*data-testid="row-pick"[^>]*>/) ?? [];
    expect(pick).toContain('class="match-row-pick');
    expect(pick).toContain(`href="/en/match/${fixture().id}#pick"`);
    expect(pick).toContain('aria-label="Pick: Liverpool v Brighton"');
    expect(html).toMatch(/self-end"[^>]*data-testid="fixture-state"/);
    expect(html).toContain(`href="/en/match/${fixture().id}"`);
  });

  it('says "not supplied" on a row the model has no forecast for, and "Not loaded" when the answer did not come', () => {
    const none = line(fixture(), { forecast: { state: 'none' } });
    expect(none).toMatch(/data-testid="row-forecast" data-state="none"/);
    expect(none).toContain('data-coverage-badge="not_supplied"');
    expect(none).not.toContain('row-bar');
    const unavailable = line(fixture(), {
      forecast: {
        state: 'unavailable',
        reason: null,
        version: 1,
        computed_at: available.computed_at,
      },
    });
    expect(unavailable).toContain('data-coverage-badge="not_supplied"');
    expect(line(fixture(), { forecast: { state: 'unreachable' } })).toContain('Not loaded');
    // Not asked: no cell, never an empty one.
    expect(line(fixture())).not.toContain('row-forecast');
  });

  it('offers no Pick once the match has kicked off, nor without the render’s moment', () => {
    expect(line(fixture(), { now: Date.parse('2026-10-25T14:05:00.000Z') })).not.toContain(
      'row-pick',
    );
    expect(line(fixture())).not.toContain('row-pick');
    expect(line(fixture())).toMatch(/row-span-2"[^>]*data-testid="fixture-state"/);
  });

  it('draws a finished match as the 56px row: no bar, FT and its day, the winner bold, the loser muted', () => {
    const done = fixture({ status: 'finished', score: { home: 2, away: 1 } });
    const html = line(done, { forecast: available, now: before });
    expect(html).toContain('class="match-row match-row-done"');
    expect(html).not.toContain('row-forecast');
    expect(html).not.toContain('row-pick');
    expect(text(html)).toContain('FT25 Oct');
    expect(html).toMatch(/font-extrabold"><bdi|<bdi class="[^"]*font-extrabold[^"]*">Liverpool/);
    expect(html).toMatch(/<bdi class="[^"]*font-medium text-muted[^"]*">Brighton/);
    const fa = line(done, { locale: 'fa' });
    expect(fa).toMatch(/data-testid="home-score"[^>]*>۲</);
    expect(fa).toMatch(/data-testid="away-score"[^>]*>۱</);
    expect(text(fa)).not.toMatch(/[0-9]/);
  });

  it('keeps both sides in ink after a draw', () => {
    const html = line(fixture({ status: 'finished', score: { home: 1, away: 1 } }));
    expect(html).not.toContain('text-muted">Liverpool');
    expect(html).not.toMatch(/<bdi class="[^"]*text-muted/);
  });

  it('lets a long name wrap rather than cutting it short (T-1555, D-374)', () => {
    const long = fixture({
      home: { ...fixture().home, name: 'Nottingham Forest', short_name: null },
      away: { ...fixture().away, name: 'Wolverhampton Wanderers', short_name: null },
    });
    const html = line(long, { forecast: available });
    expect(html).toContain('Nottingham Forest');
    expect(html).toContain('Wolverhampton Wanderers');
    expect(html).not.toContain('truncate');
    expect(html).toMatch(/<bdi class="min-w-0 break-words hyphens-auto/);
  });

  it('says a postponed match is postponed and a live one is live, with its goals in the live colour', () => {
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
    expect(html).toMatch(/text-live[^>]*data-testid="fixture-status"[^>]*>live</);
    expect(html).toMatch(/font-bold text-live" data-testid="home-score">1</);
  });

  it('says "Awaiting update" for a match still scheduled long after its kick-off, never its time (T-1710, D-343)', () => {
    const stuck = fixture({ kickoff_at: '2026-10-01T16:00:00.000Z', freshness: 'awaiting_update' });
    const en = line(stuck);
    expect(en).toMatch(/text-warning[^>]*data-testid="fixture-status"[^>]*>Awaiting update</);
    expect(en).not.toContain('16:00');
    expect(line(stuck, { locale: 'fa' })).toContain('در انتظار به‌روزرسانی');
  });

  it('shares the scores row’s pieces rather than a copy (D-374)', () => {
    expect(SOURCE).toContain("import { NAME } from '@/components/score-card';");
    expect(SOURCE).toContain("import { RowForecast } from '@/components/score-card-forecast';");
    expect(SOURCE).not.toContain('ModelFigures');
    const css = readFileSync(join(__dirname, '..', '..', '..', 'globals.css'), 'utf8');
    expect(css).toMatch(/\.match-row\.match-row-done \{\s*@apply min-h-14/);
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
    expect(html).toMatch(/data-testid="home-score">3</);
    expect(text(html)).toContain('20:00');
    // The bar on the two still to come (one with a forecast, one 'not supplied'); none on the result.
    expect(html.match(/data-testid="row-bar"/g)).toHaveLength(1);
    expect(html).toContain('data-testid="row-forecast" data-state="none"');
    expect(html.match(/data-testid="row-forecast"/g)).toHaveLength(2);
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
    expect(html).toMatch(/data-testid="home-score">0<.*data-testid="away-score">2</);
    expect(html).toContain('match-row-done');
    expect(renderToStaticMarkup(<ResultsCard day={null} locale="en" timeZone="UTC" />)).toContain(
      'data-testid="results-day-empty"',
    );
  });
});

describe('the Matches tab, one round at a time (T-1762, D-378)', () => {
  const words = {
    'freshness.checked': message('en', 'freshness.checked'),
    'freshness.behind': message('en', 'freshness.behind'),
  };
  // Saturday 31 October 2026, 12:00 UTC: matchweek 10's Friday game is played.
  const now = Date.parse('2026-10-31T12:00:00.000Z');
  const played = (id: string, round: number, day: string, home = 2, away = 1) =>
    fixture({
      id,
      round: `Regular Season - ${round}`,
      kickoff_at: `${day}T15:00:00.000Z`,
      status: 'finished',
      score: { home, away },
    });
  const toCome = (id: string, round: number, day: string) =>
    fixture({ id, round: `Regular Season - ${round}`, kickoff_at: `${day}T15:00:00.000Z` });
  const season = page({
    results: [
      played('r10a', 10, '2026-10-30'),
      played('r9c', 9, '2026-10-25'),
      played('r9b', 9, '2026-10-24', 1, 1),
      played('r9a', 9, '2026-10-24'),
    ],
    fixtures: [
      toCome('r10b', 10, '2026-10-31'),
      toCome('r10c', 10, '2026-11-01'),
      toCome('r11a', 11, '2026-11-07'),
      toCome('r11b', 11, '2026-11-07'),
    ],
    last_updated_at: '2026-10-31T11:59:00.000Z',
  });
  const rounds = seasonRounds('en', season, 'Europe/London');
  const tab = (
    view: MatchView,
    asked: number | null = null,
    over: {
      locale?: string;
      page?: CompetitionPage;
      forecasts?: Record<string, CardForecast>;
    } = {},
  ) => {
    const locale = over.locale ?? 'en';
    const p = over.page ?? season;
    const all = seasonRounds(locale, p, 'Europe/London');
    return renderToStaticMarkup(
      <MatchesTab
        page={p}
        locale={locale}
        timeZone="Europe/London"
        now={now}
        freshnessWords={words}
        rounds={all}
        list={matchList(view, all, p, asked)}
        forecasts={over.forecasts ?? {}}
      />,
    );
  };
  const tags = (html: string, id: string) =>
    [...html.matchAll(new RegExp(`<(?:a|span) [^>]*data-testid="${id}"[^>]*>`, 'g'))].map(
      (m) => m[0],
    );

  it('has the two-way switch as plain links, each with its count, the shown one current', () => {
    const html = tab('upcoming');
    const [up] = tags(html, 'matches-view-upcoming');
    const [res] = tags(html, 'matches-view-results');
    expect(up).toContain(`href="/en/competition/${ID}?tab=matches&amp;view=upcoming"`);
    expect(up).toContain('aria-current="true"');
    expect(up).toContain('min-h-touch');
    expect(res).toContain(`href="/en/competition/${ID}?tab=matches&amp;view=results"`);
    expect(res).not.toContain('aria-current');
    expect(text(html)).toContain('Upcoming4');
    expect(text(html)).toContain('Results4');
    expect(html).toContain('<nav aria-label="Matches to show"');
  });

  it('opens Upcoming at the round of the next match, with only its matches to come', () => {
    const html = tab('upcoming', null, { forecasts: { r10b: available } });
    expect(html).toContain('data-testid="round-title">Matchweek 10<');
    expect(html.match(/data-testid="fixture"/g)).toHaveLength(2);
    expect(html).not.toContain('/en/match/r10a"');
    // The rows: D-374's 72px row, the one bar, "not supplied" on the one without.
    expect(html).not.toContain('match-row-done');
    expect(html.match(/data-testid="row-bar"/g)).toHaveLength(1);
    expect(html).toContain('data-coverage-badge="not_supplied"');
    expect(html).toContain('model %');
    // A short list says why it is short (rule 3).
    expect(text(html)).toContain('1 match of this round is already played; it is under Results.');
    // Its freshness line (rule 4) and the zone.
    expect(html).toContain('data-testid="matches-freshness"');
    expect(text(html)).toContain('Matches last changed');
    expect(text(html)).toContain('UK time');
  });

  it('lists and steps through only Upcoming’s rounds, the position the season’s own', () => {
    const html = tab('upcoming');
    expect(html).toContain('data-testid="round-position">2 of 3<');
    const options = tags(html, 'round-option');
    expect(options).toHaveLength(2);
    expect(options[0]).toContain(`?tab=matches&amp;view=upcoming&amp;round=2"`);
    expect(options[1]).toContain(`?tab=matches&amp;view=upcoming&amp;round=3"`);
    // No earlier round has a match to come: the step is inert.
    expect(tags(html, 'round-prev')[0]).toMatch(/^<span [^>]*aria-hidden="true"/);
    expect(tags(html, 'round-next')[0]).toContain(
      `href="/en/competition/${ID}?tab=matches&amp;view=upcoming&amp;round=3"`,
    );
  });

  it('opens Results at the latest round with a result and says how much of it is played', () => {
    const html = tab('results');
    expect(html).toContain('data-testid="round-title">Matchweek 10<');
    expect(html.match(/data-testid="fixture"/g)).toHaveLength(1);
    expect(text(html)).toContain('1 of 3 matches played. The other 2 are under Upcoming.');
    // A finished row: 56px, no bar, nothing of the model on the card.
    expect(html).toContain('match-row match-row-done');
    expect(html).not.toContain('row-forecast');
    expect(html).not.toContain('model %');
    // Matchweek 11 has no result: the step is inert; matchweek 9 is one tap back.
    expect(tags(html, 'round-next')[0]).toMatch(/^<span [^>]*aria-hidden="true"/);
    expect(tags(html, 'round-prev')[0]).toContain('view=results&amp;round=1"');
    expect(tags(html, 'round-option')).toHaveLength(2);
  });

  it('opens the round asked for when the list holds it, and its own otherwise', () => {
    const full = tab('results', 1);
    expect(full).toContain('data-testid="round-title">Matchweek 9<');
    expect(full.match(/data-testid="fixture"/g)).toHaveLength(3);
    expect(full).not.toContain('matches-partial');
    expect(tab('results', 3)).toContain('data-testid="round-title">Matchweek 10<');
    expect(tab('upcoming', 3)).toContain('data-testid="round-title">Matchweek 11<');
  });

  it('says there is nothing to list rather than drawing an empty round', () => {
    const none = page({ results: [], fixtures: [] });
    const up = tab('upcoming', null, { page: none });
    expect(up).toContain('data-testid="fixtures-empty"');
    expect(up).toContain('No fixtures scheduled for this season.');
    expect(up).not.toContain('round-picker');
    expect(tab('results', null, { page: none })).toContain('No results stored for this season.');
  });

  it('is in Persian on /fa, mirrored by logical properties alone', () => {
    const html = tab('results', null, { locale: 'fa' });
    expect(html).toContain('پیش رو');
    expect(html).toContain('نتایج');
    expect(text(html)).toContain('۱ از ۳ بازی انجام شده است. ۲ بازی دیگر در «پیش رو» است.');
    expect(text(html)).not.toMatch(/[0-9]/);
    expect(html).not.toContain('data-translation="untranslated"');
    expect(html).not.toMatch(PHYSICAL);
    expect(tab('upcoming')).not.toMatch(PHYSICAL);
  });

  it('heads a round it cannot name by its dates and says once that the names are not supplied (D12)', () => {
    const cup = page({
      competition: { ...page().competition, kind: 'cup' },
      results: [
        fixture({ id: 'c1', round: null, status: 'finished', score: { home: 1, away: 0 } }),
      ],
      fixtures: [fixture({ id: 'c2', round: null, kickoff_at: '2026-11-07T15:00:00.000Z' })],
    });
    const html = tab('upcoming', null, { page: cup });
    expect(html.match(/data-testid="round-names-absent"/g)).toHaveLength(1);
    expect(text(html)).toContain('Round names are not supplied for this competition');
    expect(html).toContain('data-testid="round-title">Saturday 7 November<');
    // The Overview's card says it too; a named round does not.
    const all = seasonRounds('en', cup, 'UTC');
    const overview = renderToStaticMarkup(
      <MatchweekCard
        rounds={all}
        round={all[0]!}
        href={(n) => `/en/competition/${ID}?round=${n}#match-day`}
        forecasts={{}}
        page={cup}
        locale="en"
        timeZone="UTC"
        now={now}
        freshnessWords={words}
      />,
    );
    expect(overview).toContain('data-testid="round-names-absent"');
    expect(tab('upcoming')).not.toContain('round-names-absent');
  });

  it('says a continental cup’s missing league-phase table in one line, with its coverage (D13)', () => {
    const html = renderToStaticMarkup(<TableMissingCard locale="en" />);
    expect(html).toContain('data-testid="table-missing"');
    expect(html).toContain('data-coverage-badge="not_supplied"');
    expect(text(html)).toContain(
      'This season’s league-phase or group table is not in our records; only its knockout rounds are.',
    );
    expect(renderToStaticMarkup(<TableMissingCard locale="fa" />)).toContain(
      'جدول مرحله‌ی لیگ یا گروهی این فصل',
    );
  });

  it('keeps the competition page free of client code (no script added)', () => {
    expect(SOURCE).not.toContain("'use client'");
    expect(SOURCE).not.toMatch(/from '@\/components\/live-scores'/);
    expect(rounds).toHaveLength(3);
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
