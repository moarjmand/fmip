import type { MatchCentre, ScoreCard as ScoreCardData } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MatchCentreView, SECTIONS, TABS } from './match-centre-view';
import { Coverage, HeadToHead, MatchForm } from './match-record';
import { CardDetails, ScoreCard } from './score-card';
import { EN } from '@/i18n/messages';
import { matchWords, scoresWords } from '@/lib/words-server';

const SCORES_EN = scoresWords('en');
const MATCH_EN = matchWords('en');

/**
 * Scores and the match centre, phone first (T-605). Rendered, not read from
 * the source: what is asserted is the markup a phone gets -- one row per
 * match with the rest in its preview's details (T-1496), and a
 * match page whose sections are plain anchors, the three prediction products
 * three of them.
 */

const card = (over: Partial<ScoreCardData> = {}): ScoreCardData => ({
  id: '00000000-0000-4000-8000-000000000901',
  kickoff_at: '2025-01-05T16:30:00.000Z',
  status: 'live',
  minute: 67,
  competition: { id: 'c', name: 'Premier League', short_name: null, country_id: null },
  season: { id: 's', label: '2024/25' },
  stage: null,
  round: 'Regular Season - 20',
  leg: null,
  home: { id: 'h', name: 'Liverpool', short_name: null, code: 'LIV' },
  away: { id: 'a', name: 'Manchester United', short_name: null, code: 'MUN' },
  scores: {
    current: { home: 2, away: 1 },
    half_time: null,
    full_time: null,
    extra_time: null,
    penalties: null,
    aggregate: null,
  },
  red_cards: { home: 0, away: 1 },
  incidents: [
    { minute: 12, added_time: null, kind: 'goal', side: 'home', player: 'Salah' },
  ] as ScoreCardData['incidents'],
  venue: { id: 'v', name: 'Anfield', city: 'Liverpool' },
  coverage: 'available',
  last_updated_at: '2025-01-05T17:40:00.000Z',
  freshness: null,
  pinned: false,
  ...over,
});

describe('a match on the scores list', () => {
  const html = renderToStaticMarkup(
    <ul>
      <ScoreCard words={SCORES_EN} card={card()} timeZone="UTC" locale="en" />
    </ul>,
  );

  it('is one link to the match with the live minute, both names isolated and wrapped before they are cut', () => {
    expect(html).toContain('data-testid="match-link"');
    expect(html).toContain('href="/en/match/00000000-0000-4000-8000-000000000901"');
    expect(html).toMatch(/data-testid="score-status"[^>]*>67′</);
    expect(html).toMatch(/text-live" data-testid="score-status"/);
    expect(html).toMatch(
      /<bdi class="line-clamp-2 break-words leading-tight max-sm:text-sm font-semibold" title="Liverpool">Liverpool<\/bdi>/,
    );
    expect(html).toMatch(
      /<bdi class="line-clamp-2 break-words leading-tight max-sm:text-sm font-semibold" title="Manchester United">/,
    );
    expect(html).toContain('min-h-11');
    expect(html).toContain('aria-label="one red card"');
    // T-1496: the teams stacked, each with its own goals at the line's end.
    expect(html).toMatch(/data-testid="home-score"[^>]*>2</);
    expect(html).toMatch(/data-testid="away-score"[^>]*>1</);
  });

  it('keeps every label in the preview’s details, none on the row (T-1496)', () => {
    expect(html).not.toContain('<details');
    for (const id of ['score-card', 'home-team', 'away-team', 'home-score', 'row-forecast']) {
      expect(html).toContain(`data-testid="${id}"`);
    }
    const details = renderToStaticMarkup(
      <CardDetails words={SCORES_EN} card={card()} timeZone="UTC" locale="en" revealed />,
    );
    for (const id of ['incidents', 'card-labels']) {
      expect(details).toContain(`data-testid="${id}"`);
    }
    // T-940: three lines, each saying why when it has no figure.
    expect(details).toContain('data-testid="card-forecast" data-state="not_loaded"');
    expect(details).toContain('data-testid="card-community" data-state="not_loaded"');
    expect(details).toContain('data-testid="card-viewing" data-state="not_loaded"');
    expect(details).toContain('not loaded for this list');
    expect(details).toContain('Updated <time dateTime="2025-01-05T17:40:00.000Z">');
    expect(details).toContain('Anfield, Liverpool');
  });

  it('carries the model line, the community totals and the viewing line, each named (T-940)', () => {
    const full = renderToStaticMarkup(
      <CardDetails
        words={SCORES_EN}
        card={card({ status: 'scheduled', minute: null })}
        timeZone="UTC"
        locale="en"
        revealed
        forecast={{
          state: 'available',
          home: 46.4,
          draw: 26.2,
          away: 27.4,
          version: 3,
          model_version: 'dixon-coles-elo@0.3.0',
          computed_at: '2025-01-05T15:30:00.000Z',
        }}
        community={{ state: 'below_floor' }}
        viewing={{ state: 'ask' }}
      />,
    );
    expect(full).toMatch(/data-testid="card-forecast" data-state="available"/);
    expect(full).toContain('46.4%');
    expect(full).toContain('forecast no. 3');
    expect(full).toContain('not published until 5 members have predicted');
    expect(full).toContain('href="/en/watch"');

    const none = renderToStaticMarkup(
      <CardDetails
        words={SCORES_EN}
        card={card()}
        timeZone="UTC"
        locale="en"
        revealed
        forecast={{ state: 'none' }}
        community={{ state: 'available', sample: 7, home: 4, draw: 1, away: 2 }}
        viewing={{ state: 'nothing_listed', territory: 'Iran' }}
      />,
    );
    expect(none).toContain('the model had no forecast for this match before kick-off.');
    expect(none).toContain('of 7 members, not the model');
    expect(none).toContain('nothing listed in Iran');
  });

  it('keeps a leg, an aggregate and the competition of a favourite on the row', () => {
    const row = renderToStaticMarkup(
      <ScoreCard
        words={SCORES_EN}
        card={card({ leg: 2, scores: { ...card().scores, aggregate: { home: 3, away: 3 } } })}
        timeZone="UTC"
        locale="en"
        showCompetition
      />,
    );
    const meta = row.slice(row.indexOf('data-testid="row-meta"'), row.indexOf('</a>'));
    expect(meta).toContain('Premier League');
    expect(meta).toContain('Leg 2');
    expect(meta).toContain('Agg');
  });

  it('says on the row itself when its data is behind (rule 4)', () => {
    const row = renderToStaticMarkup(
      <ScoreCard
        words={SCORES_EN}
        card={card({ freshness: 'stale' })}
        timeZone="UTC"
        locale="en"
        now={Date.parse('2025-01-05T18:00:00Z')}
      />,
    );
    expect(row).toContain('data-testid="behind"');
    expect(row).toContain('role="status"');
    expect(row).toMatch(/data-testid="score-status"[^>]*>Behind</);
  });
});

/**
 * The view as the page renders it (T-1384): the parts that do not move in
 * play -- form, head-to-head, absences, coverage -- are drawn on the server
 * and handed in as slots, so they are rendered here the same way.
 */
function FullView(props: React.ComponentProps<typeof MatchCentreView>) {
  const { centre, timeZone, locale, words, slots = {} } = props;
  return (
    <MatchCentreView
      {...props}
      slots={{
        form: <MatchForm centre={centre} timeZone={timeZone} locale={locale} words={words} />,
        headToHead: (
          <HeadToHead centre={centre} timeZone={timeZone} locale={locale} words={words} />
        ),
        coverage: <Coverage centre={centre} words={words} />,
        ...slots,
      }}
    />
  );
}

const covered = <T,>(data: T) => ({
  coverage: 'available' as const,
  last_updated_at: '2025-01-05T17:40:00.000Z',
  data,
});

const centre: MatchCentre = {
  fixture: {
    id: '00000000-0000-4000-8000-000000000901',
    kickoff_at: '2025-01-05T16:30:00.000Z',
    status: 'live',
    minute: 67,
    competition: { id: 'c', name: 'Premier League', short_name: null, country_id: null },
    season: { id: 's', label: '2024/25' },
    stage: null,
    round: null,
    group_name: null,
    leg: null,
    home: {
      id: 'h',
      name: 'Liverpool',
      short_name: null,
      code: 'LIV',
      formation: '4-3-3',
      coach: null,
    },
    away: {
      id: 'a',
      name: 'Manchester United',
      short_name: null,
      code: 'MUN',
      formation: null,
      coach: null,
    },
    scores: {
      current: { home: 2, away: 1 },
      half_time: { home: 1, away: 1 },
      full_time: null,
      extra_time: null,
      penalties: null,
      aggregate: null,
    },
    venue: null,
    is_neutral_venue: false,
    referee: null,
    attendance: null,
    periods: [],
    last_updated_at: '2025-01-05T17:40:00.000Z',
    freshness: null,
  },
  timeline: covered([]),
  statistics: covered([{ metric: 'shots', home: 10, away: 4 }]),
  lineups: covered({ home: [], away: [] }),
  availability: covered([]),
  player_statistics: { coverage: 'not_supplied', last_updated_at: null, data: null },
  player_expected_goals: {
    source: 'highlightly',
    unplaced: 0,
    coverage: 'not_supplied',
    last_updated_at: null,
    data: null,
  },
  form: {
    home: { coverage: 'not_supplied', last_updated_at: null, data: null },
    away: { coverage: 'not_supplied', last_updated_at: null, data: null },
  },
  head_to_head: covered([]),
  coverage: {
    scores: 'available',
    incidents: 'available',
    lineups: 'available',
    statistics: 'available',
    standings: 'limited',
    availability: 'limited',
    advanced_statistics: 'not_supplied',
  },
};

describe('the match centre', () => {
  const html = renderToStaticMarkup(
    <FullView
      words={MATCH_EN}
      centre={centre}
      timeZone="Asia/Tehran"
      locale="en"
      slots={{
        context: <p>TABLE</p>,
        forecast: <p>MODEL</p>,
        analysis: <p>FOUNDER</p>,
        community: <p>CROWD</p>,
        discussion: <p>TALK</p>,
        watch: <p>TV</p>,
        news: <p>NEWS</p>,
        players: <p>PLAYERS</p>,
      }}
    />,
  );

  it('opens with the score band: teams, score, minute, kick-off in the viewer’s zone', () => {
    const header = html.slice(0, html.indexOf('</header>'));
    expect(header).toContain('data-testid="match-header"');
    expect(header).toMatch(/data-testid="match-status">67′</);
    expect(header).toMatch(/<bdi class="[^"]*">Liverpool<\/bdi>/);
    // The live badge in saffron, with the word and the pulsing dot (T-1497).
    expect(header).toMatch(
      /bg-live\/15 text-live" data-testid="live-badge"><span aria-hidden="true" class="live-dot/,
    );
    // The score large and narrow, home first in the page's direction (D-193).
    expect(header).toMatch(
      /<span dir="ltr" class="[^"]*font-stretch-condensed[^"]*" data-testid="score">2</,
    );
    // 16:30 UTC is 20:00 in Tehran.
    expect(header).toMatch(/Kick-off <time dateTime="2025-01-05T16:30:00.000Z">[^<]*20:00/);
    expect(header).toContain('Last data update');
  });

  it('has a tab bar of plain anchors, each to a section that exists (T-1384, T-1497)', () => {
    const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
    // At every width, at the foot of the score band: jump links from 768px.
    expect(nav).toContain('data-testid="section-nav"');
    expect(html.indexOf('data-testid="section-nav"')).toBeLessThan(html.indexOf('</header>'));
    for (const [tab, label] of TABS) {
      expect(nav).toContain(`href="#${tab}"`);
      expect(nav).toContain(`data-tab-link="${tab}"`);
      expect(nav).toContain(EN[label].replace("'", '&#x27;'));
      expect(html).toContain(`id="${tab}"`);
    }
    expect(nav).not.toContain('<button');
    // Every anchor another page links to is still on the page, in its tab.
    for (const [id, tab] of Object.entries(SECTIONS)) {
      if (id === 'verdict') continue; // after full time only
      const at = html.indexOf(`id="${id}"`);
      expect(at).toBeGreaterThan(-1);
      const panel = html.lastIndexOf(`data-tab="${tab}"`, at + `id="${id}"`.length + 200);
      expect(panel).toBeGreaterThan(-1);
    }
  });

  it('lays the sections out in a main and a side column from 768px and as tabs below it', () => {
    expect(html).toContain('data-match-tabs=""');
    for (const column of ['main', 'side']) {
      expect(html).toMatch(new RegExp(`max-md:contents[^"]*" data-column="${column}"`));
    }
    // The Design System's flex: the main column 999 1 640px, the side 1 1 340px.
    expect(html).toMatch(/md:grow-999 md:basis-160" data-column="main"/);
    expect(html).toMatch(/md:grow md:basis-85" data-column="side"/);
    // The side column's sections belong to the Summary tab on a phone.
    expect(html).toMatch(/data-column="side"><div class="[^"]*" data-tab="summary">/);
  });

  it('keeps the model, the founder and the community in three sections, in that order', () => {
    const at = (id: string) => html.indexOf(`id="${id}"`);
    expect(at('forecast')).toBeLessThan(at('analysis'));
    expect(at('analysis')).toBeLessThan(at('community'));
    const section = (id: string, next: string) => html.slice(at(id), at(next));
    expect(section('forecast', 'analysis')).toContain('MODEL');
    expect(section('forecast', 'analysis')).not.toMatch(/FOUNDER|CROWD/);
    expect(section('analysis', 'community')).toContain('FOUNDER');
    expect(section('analysis', 'community')).not.toMatch(/MODEL|CROWD/);
    expect(section('community', 'watch')).toContain('CROWD');
    expect(section('community', 'watch')).not.toMatch(/MODEL|FOUNDER/);
    // All three inside the one Predictions tab, never merged into one section.
    expect(at('predictions')).toBeLessThan(at('forecast'));
  });

  it('draws each statistic as a split bar, home in ink and away in grey (Design System StatBar)', () => {
    const stats = html.slice(html.indexOf('data-testid="statistics"'));
    expect(stats).toContain('data-testid="stat-grid"');
    expect(stats).toMatch(/data-metric="shots"/);
    // 10 of 14 shots: the two shares of one bar, home from the inline start.
    expect(stats).toMatch(/bg-fg" style="flex-grow:10;flex-basis:0"/);
    expect(stats).toMatch(/bg-border-strong" style="flex-grow:4;flex-basis:0"/);
    // Never a club colour: the brand green and the neutral token only.
    expect(stats.slice(0, stats.indexOf('</section>'))).not.toMatch(/bg-(model|founder|community)/);
  });

  it('gives a coverage badge its own gap and direction, and an empty module its own sentence', () => {
    // A flex gap, not a margin: beside an English title in a right-to-left
    // paragraph the margin landed on the far side and the two words touched.
    expect(html).toMatch(
      /<h2 class="flex flex-wrap items-center justify-between gap-x-2[^"]*"><span class="[^"]*">Player statistics<\/span><span dir="auto"/,
    );
    expect(html).toContain(
      '<p dir="auto" class="text-sm text-muted">Not supplied for this match.</p>',
    );
    expect(html).toContain(
      '<p dir="auto" class="text-xs text-muted">No competitive results held.</p>',
    );
  });

  it('leaves a tab out when the page has nothing for it', () => {
    const bare = renderToStaticMarkup(
      <FullView words={MATCH_EN} centre={centre} timeZone="UTC" locale="en" />,
    );
    expect(bare).toContain('href="#summary"');
    expect(bare).toContain('id="timeline"');
    expect(bare).not.toContain('href="#predictions"');
    expect(bare).not.toContain('id="forecast"');
    expect(bare).not.toContain('href="#watch"');
  });
});

describe('the scores card and the match centre in Persian (T-1303)', () => {
  const card_ =
    renderToStaticMarkup(
      <ul>
        <ScoreCard words={scoresWords('fa')} card={card()} timeZone="UTC" locale="fa" />
      </ul>,
    ) +
    renderToStaticMarkup(
      <CardDetails words={scoresWords('fa')} card={card()} timeZone="UTC" locale="fa" revealed />,
    );
  const view = renderToStaticMarkup(
    <FullView words={matchWords('fa')} centre={centre} timeZone="Asia/Tehran" locale="fa" />,
  );

  it('says the card in Persian, with the minute and the score in Persian digits, isolated', () => {
    expect(card_).toMatch(/data-testid="score-status"[^>]*>۶۷′</);
    // Each side's goals on its own line, beside its own team (T-1375, T-1496).
    expect(card_).toMatch(/data-testid="home-score"[^>]*>۲</);
    expect(card_).toMatch(/data-testid="away-score"[^>]*>۱</);
    expect(card_).toContain('aria-label="یک کارت قرمز"');
    expect(card_).toContain('شروع بازی');
    expect(card_).toContain('نتایج: موجود');
    expect(card_).not.toContain('Kick-off');
  });

  it('names the match centre’s sections and coverage in Persian', () => {
    expect(view).toContain('رویدادهای زنده');
    expect(view).toContain('پوشش داده‌ها در این فصل');
    expect(view).toContain('موجود');
    expect(view).not.toContain('Live timeline');
    expect(view).not.toContain('data-translation="untranslated"');
  });
});

describe('why the line-ups and the absences are empty (T-1364)', () => {
  const empty = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
  const page = (over: Partial<MatchCentre>, status: MatchCentre['fixture']['status'] = 'live') =>
    renderToStaticMarkup(
      <FullView
        words={MATCH_EN}
        centre={{ ...centre, fixture: { ...centre.fixture, status }, ...over }}
        timeZone="UTC"
        locale="en"
      />,
    );
  const section = (html: string, testId: string) => {
    const from = html.indexOf(`data-testid="${testId}"`);
    return html.slice(from, html.indexOf('</section>', from));
  };

  it('says when the official line-up is usually announced, before kick-off only', () => {
    const before = section(page({ lineups: empty }, 'scheduled'), 'lineups');
    expect(before).toContain(EN['matchCentre.lineupsNotYet']);
    expect(before).toContain('about 20–40 minutes before kick-off');
    const after = section(page({ lineups: empty }, 'finished'), 'lineups');
    expect(after).toContain('Not supplied for this match.');
    expect(after).not.toContain('kick-off');
  });

  it('says the provider has no absences for the competition, never "nobody"', () => {
    const html = section(page({ availability: { ...empty, gap: 'not_covered' } }), 'availability');
    expect(html).toContain('data-coverage="not_supplied"');
    expect(html).toContain(EN['matchCentre.absencesNotCovered']);
    expect(html).not.toContain(EN['matchCentre.noAbsences']);
  });

  it('says absences are asked for from about three days out, for a match further away', () => {
    const html = section(
      page({ availability: { ...empty, gap: 'not_yet' } }, 'scheduled'),
      'availability',
    );
    expect(html).toContain(EN['matchCentre.absencesNotYet']);
    expect(html).not.toContain('Not supplied for this match.');
  });

  it('keeps the plain sentence for a match never asked about, or an API without a reason', () => {
    for (const availability of [{ ...empty, gap: 'not_asked' as const }, empty]) {
      expect(section(page({ availability }), 'availability')).toContain(
        'Not supplied for this match.',
      );
    }
  });

  it('has each sentence in Persian', () => {
    const fa = renderToStaticMarkup(
      <FullView
        words={matchWords('fa')}
        centre={{
          ...centre,
          fixture: { ...centre.fixture, status: 'scheduled' },
          lineups: empty,
          availability: { ...empty, gap: 'not_covered' },
        }}
        timeZone="UTC"
        locale="fa"
      />,
    );
    expect(fa).toContain('ترکیب رسمی معمولاً');
    expect(fa).toContain('غایبان این رقابت ثبت نمی‌شوند');
  });
});

// T-1371: «آخرین به‌روزرسانی داده‌ها ۱۶:۱۵» on 8 October, for a time on 26
// September, read as this afternoon. Every freshness time says its day.
describe('the freshness times on the match centre (T-1371)', () => {
  const NOW = Date.parse('2026-10-08T12:00:00.000Z');
  const header = (html: string) => {
    const from = html.indexOf('data-testid="last-update"');
    return html.slice(from, html.indexOf('</li>', from));
  };
  const page = (
    fixture: Partial<MatchCentre['fixture']>,
    over: Partial<MatchCentre> = {},
    locale = 'en',
  ) =>
    renderToStaticMarkup(
      <FullView
        words={matchWords(locale)}
        centre={{ ...centre, fixture: { ...centre.fixture, ...fixture }, ...over }}
        timeZone="Asia/Tehran"
        locale={locale}
        now={NOW}
      />,
    );
  const old = { status: 'scheduled' as const, last_updated_at: '2026-09-26T16:15:00.000Z' };

  it('dates a last update from another day in the viewer zone', () => {
    // 16:15 UTC is 19:45 in Tehran, twelve days before.
    expect(header(page(old))).toContain('Last data update');
    expect(header(page(old))).toContain('12 days ago (26 Sept 2026, 19:45)');
  });

  it('keeps the clock reading alone for today', () => {
    const today = header(page({ ...old, last_updated_at: '2026-10-08T09:00:00.000Z' }));
    expect(today).toMatch(/Last data update <time[^>]*>12:30</);
  });

  it('shows the last check when it is newer than the last change, and keeps the change', () => {
    const checked = header(page({ ...old, last_checked_at: '2026-10-08T11:00:00.000Z' }));
    expect(checked).toContain('Data last checked');
    expect(checked).toContain('14:30');
    expect(checked).toContain('unchanged since');
    expect(checked).toContain('12 days ago (26 Sept 2026, 19:45)');
    // A check older than the change says nothing new: the change stands.
    const stale = header(page({ ...old, last_checked_at: '2026-09-20T11:00:00.000Z' }));
    expect(stale).toContain('Last data update');
    expect(stale).not.toContain('checked');
  });

  it('says the check in Persian', () => {
    const fa = header(page({ ...old, last_checked_at: '2026-10-08T11:00:00.000Z' }, {}, 'fa'));
    expect(fa).toContain('آخرین بررسی داده‌ها');
    expect(fa).toContain('روز پیش');
  });

  it('dates an absence answer, and says past six hours before kick-off it may have changed', () => {
    const asked = (at: string, status: MatchCentre['fixture']['status']) => {
      const html = page(
        { status },
        { availability: { coverage: 'available', last_updated_at: at, data: [] } },
      );
      const from = html.indexOf('data-testid="no-absences"');
      return html.slice(from, html.indexOf('</p>', from));
    };
    const fresh = asked('2026-10-08T09:00:00.000Z', 'scheduled');
    expect(fresh).toContain('(asked 12:30)');
    expect(fresh).not.toContain('may have changed');
    const older = asked('2026-10-05T16:30:00.000Z', 'scheduled');
    expect(older).toContain('3 days ago (5 Oct 2026, 20:00)');
    expect(older).toContain('more than six hours old and may have changed');
    // After kick-off the answer is history, not a forecast: no stale words.
    expect(asked('2026-10-05T16:30:00.000Z', 'finished')).not.toContain('may have changed');
  });
});

// T-1378: the timeline said "Normal Goal", "Substitution 1" and "Goal
// cancelled" as the provider wrote them, in English on /fa (rule 2).
describe('an incident in our words, never the provider’s (T-1378)', () => {
  type Incident = NonNullable<MatchCentre['timeline']['data']>[number];
  const incident = (kind: Incident['kind'], detail: unknown): Incident => ({
    id: `${kind}-${String(detail)}`,
    sequence: 1,
    minute: 70,
    added_time: null,
    kind,
    side: 'home',
    player: kind === 'var' ? null : { id: 'p', name: 'Salah' },
    related_player: null,
    detail: detail as Incident['detail'],
  });
  const timeline = (incidents: Incident[], locale = 'en') => {
    const html = renderToStaticMarkup(
      <FullView
        words={matchWords(locale)}
        centre={{ ...centre, timeline: covered(incidents) }}
        timeZone="UTC"
        locale={locale}
      />,
    );
    const from = html.indexOf('data-testid="timeline"');
    return html.slice(from, html.indexOf('</section>', from));
  };

  it('says what a VAR review decided after its kind', () => {
    const html = timeline([incident('var', 'goal_cancelled')]);
    expect(html).toContain('VAR');
    expect(html).toContain('<span data-testid="incident-detail"> · Goal disallowed</span>');
  });

  it('says it in Persian on /fa', () => {
    const html = timeline(
      [incident('var', 'goal_cancelled'), incident('var', 'penalty_confirmed')],
      'fa',
    );
    expect(html).toContain('گل مردود شد');
    expect(html).toContain('پنالتی تأیید شد');
    expect(html).not.toMatch(/Goal disallowed|Penalty confirmed|goal_cancelled/);
  });

  it('shows only the kind for none, and never a text it does not know', () => {
    const html = timeline([
      incident('goal', null),
      // An older API, or a row that slipped past the mapping: never printed.
      incident('goal', 'Normal Goal'),
      incident('substitution', 'Substitution 1'),
      incident('var', 'Goal cancelled'),
    ]);
    expect(html).not.toContain('data-testid="incident-detail"');
    expect(html).not.toMatch(/Normal Goal|Substitution 1|Goal cancelled/);
    expect(html).toContain('Goal');
    expect(html).toContain('VAR');
  });
});
