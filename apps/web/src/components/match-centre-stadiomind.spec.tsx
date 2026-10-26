import type {
  FixtureEvaluationsResponse,
  ForecastVersion,
  ForecastVersionsResponse,
  MatchCentre,
  MatchIncident,
  MatchLineupPlayer,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/messages';
import { matchWords } from '@/lib/words-server';
import {
  ForecastReality,
  cardVersion,
  leadTime,
  receipt,
} from '../app/[locale]/match/[id]/forecast-reality';
import { MatchCentreView, ratingsOf } from './match-centre-view';
import { MatchLineupsView } from './match-lineups';

/**
 * The Stadiomind match centre (T-1497): the Summary's "what was forecast,
 * what happened" card with every version and its receipt, the live states
 * ("Not in yet", the badge, a feed that has fallen behind), the timeline's
 * axis, the ratings on the pitch and the best rated.
 */

const KICKOFF = '2026-10-24T11:30:00.000Z';

const version = (
  n: number,
  computedAt: string,
  p: ForecastVersion['probabilities'] = { home: 0.211, draw: 0.248, away: 0.541 },
): ForecastVersion => ({
  id: `v${n}`,
  fixture_id: 'f1',
  version_number: n,
  kind: n === 3 ? 'lineups_confirmed' : 'early',
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: computedAt,
  status: p === null ? 'unavailable' : 'available',
  probabilities: p,
  expected_goals: p === null ? null : { home: 1.11, away: 1.87 },
  most_likely_scorelines:
    p === null
      ? null
      : [
          { home: 1, away: 1, probability: 0.117 },
          { home: 1, away: 2, probability: 0.099 },
          { home: 0, away: 2, probability: 0.089 },
          { home: 0, away: 1, probability: 0.083 },
          { home: 0, away: 0, probability: 0.062 },
        ],
  leading_factors: null,
  data_completeness: 'available',
  inputs: {
    model_version: 'dixon-coles-elo@0.6.0',
    fit_date: '2026-10-23',
    matches_used: 1120,
    elo_used: true,
    history_from: '2023-10-01',
    data_completeness: 'available',
  },
  unavailable_reason: p === null ? 'model_unreachable' : null,
  unavailable_detail: null,
});

// Sent out of order on purpose: the card lists them by number.
const versions = [
  version(3, '2026-10-24T11:03:00.000Z'),
  version(1, '2026-10-17T11:32:00.000Z', { home: 0.224, draw: 0.251, away: 0.525 }),
  version(2, '2026-10-18T11:35:00.000Z', null),
];
const forecasts: ForecastVersionsResponse = {
  fixture_id: 'f1',
  coverage: 'available',
  last_updated_at: '2026-10-24T11:03:00.000Z',
  latest: versions[0] ?? null,
  versions,
};
const team = (id: string, name: string) => ({
  id,
  name,
  short_name: null,
  code: null,
  formation: '4-4-2',
  coach: null,
});
const fixture = (status: 'scheduled' | 'live' | 'finished') => ({
  status,
  kickoff_at: KICKOFF,
  home: team('h', 'Aston Villa'),
  away: team('a', 'Manchester City'),
});

const card = (
  status: 'scheduled' | 'live' | 'finished',
  over: {
    forecasts?: ForecastVersionsResponse | null;
    evaluations?: FixtureEvaluationsResponse | null;
    final?: { home: number; away: number } | null;
    matchXg?: { home: number; away: number } | null;
    locale?: string;
  } = {},
) =>
  renderToStaticMarkup(
    <ForecastReality
      forecasts={over.forecasts === undefined ? forecasts : over.forecasts}
      evaluations={over.evaluations ?? null}
      fixture={fixture(status)}
      final={
        over.final === undefined
          ? status === 'finished'
            ? { home: 2, away: 1 }
            : null
          : over.final
      }
      matchXg={over.matchXg === undefined ? { home: 0.6, away: 1.53 } : over.matchXg}
      timeZone="Europe/London"
      locale={over.locale ?? 'en'}
    />,
  );

describe('what was forecast, what happened (the Summary card)', () => {
  it('after full time sets the version from before kick-off against the result, the outcome in saffron', () => {
    const html = card('finished');
    expect(html).toContain('What was forecast, what happened');
    expect(html).toContain('data-testid="outcome-bar"');
    // The home win happened: its label says so and its segment is saffron.
    expect(html).toMatch(/data-happened="" class="text-accent">Aston Villa 21\.1% · happened/);
    expect(html).toMatch(/<span data-outcome="home" class="bg-accent"/);
    expect(html).toMatch(/<span data-outcome="away" class="bg-model\/25"/);
    expect(html).toContain('The model gave what happened 21.1% before kick-off.');
  });

  it('sets the model’s expected goals beside the match’s xG and the goals', () => {
    const html = card('finished');
    expect(html).toMatch(
      /Model, before kick-off<\/dt><dd class="[^"]*text-model[^"]*">⁦1\.11 – 1\.87/,
    );
    expect(html).toMatch(/Chances created \(match xG\)<\/dt><dd[^>]*>⁦0\.60 – 1\.53/);
    expect(html).toMatch(/Goals<\/dt><dd class="[^"]*text-accent[^"]*">⁦2 – 1/);
    // A match xG the feed did not send is said, never a 0.00.
    expect(card('finished', { matchXg: null })).toMatch(
      /Chances created \(match xG\)<\/dt><dd[^>]*>not supplied/,
    );
  });

  it('says whether the score was among the five likeliest', () => {
    expect(card('finished')).toContain('2–1⁩ was not among them.');
    expect(card('finished', { final: { home: 1, away: 1 } })).toContain('1–1⁩ was among them.');
  });

  it('lists every version by its number, each as computed, the one it is about marked (rule 5)', () => {
    const html = card('finished');
    const rows = [...html.matchAll(/data-version="(\d)"/g)].map((m) => m[1]);
    expect(rows).toEqual(['1', '2', '3']);
    expect(html).toMatch(/data-version="3" data-current=""/);
    // Each row its own figures: v1 as it was, never re-drawn from v3.
    expect(html).toMatch(/data-version="1"[^]*22\.4% · 25\.1% · 52\.5%[^]*data-version="2"/);
    // A version that gave no figures says why.
    expect(html).toMatch(/data-version="2"[^]*The model service could not be reached/);
    // The card renders the stored rows and never changes them.
    expect(versions.map((v) => v.version_number)).toEqual([3, 1, 2]);
  });

  it('carries the receipt: model, version, time, lead, kind and what it was fitted on', () => {
    const html = card('finished');
    // The `@` set apart: no "name@x.y.z" run for Cloudflare to rewrite (T-1580).
    expect(html).not.toMatch(/\S+@\d+\.\d+\.\d+/);
    expect(html.replace(/<[^>]+>/g, '')).toContain(
      'dixon-coles-elo@0.6.0 · v3 computed 24 Oct, 12:03 UK time, 27 min before kick-off · Confirmed line-ups · fitted 23 Oct on 1,120 matches since Oct 2023 · Elo prior on · inputs complete',
    );
  });

  it('while the match is on, shows the forecast from before kick-off, fixed', () => {
    const html = card('live');
    expect(html).toContain('Before kick-off');
    expect(html).not.toContain('data-happened');
    expect(html).toContain('fixed at kick-off, not changed during play');
    expect(html).not.toContain('Chances created');
  });

  it('before kick-off shows the latest; with none, or no answer, says so (rule 3)', () => {
    expect(card('scheduled')).toContain('Model forecast');
    const none = { ...forecasts, latest: null, versions: [] };
    expect(card('scheduled', { forecasts: none })).toContain(EN['forecast.none']);
    expect(card('finished', { forecasts: none })).toContain(EN['forecastBar.noneBefore']);
    expect(card('finished', { forecasts: null })).toContain(EN['forecast.unreachable']);
    expect(card('finished', { forecasts: null })).not.toContain('data-testid="receipt"');
  });

  it('picks the scored version, else the last before kick-off, else the latest before it starts', () => {
    const scored: FixtureEvaluationsResponse = {
      fixture_id: 'f1',
      coverage: 'available',
      last_updated_at: null,
      evaluations: [{ version_number: 1, pre_kickoff: true } as never],
    };
    expect(cardVersion(forecasts, scored, 'finished', KICKOFF)?.version_number).toBe(1);
    expect(
      cardVersion(forecasts, null, 'finished', '2026-10-20T00:00:00.000Z')?.version_number,
    ).toBe(2);
    expect(cardVersion(forecasts, null, 'scheduled', KICKOFF)?.version_number).toBe(3);
  });

  it('says how long before kick-off in minutes, hours or days', () => {
    expect(leadTime('en', '2026-10-24T11:03:00.000Z', KICKOFF)).toBe('27 min before kick-off');
    expect(leadTime('en', '2026-10-23T11:30:00.000Z', KICKOFF)).toBe('24 h before kick-off');
    expect(leadTime('en', '2026-10-17T11:32:00.000Z', KICKOFF)).toBe('6 days before kick-off');
    expect(leadTime('en', '2026-10-24T12:00:00.000Z', KICKOFF)).toBe('after kick-off');
  });

  it('says it in Persian with Persian digits', () => {
    const html = card('finished', { locale: 'fa' });
    expect(html).toContain('آنچه پیش‌بینی شد و آنچه رخ داد');
    expect(html).toContain('۲۷ دقیقه پیش از شروع بازی');
    expect(html).toContain('۱٬۱۲۰');
    expect(html).not.toContain('data-translation="untranslated"');
    // The receipt's time and lead joined by the Persian comma, not a Latin one (T-1554).
    expect(html.replace(/<[^>]+>/g, '')).toContain('، ۲۷ دقیقه پیش از شروع بازی');
  });

  it('names no model on the receipt of a version no model answered (T-1554)', () => {
    const none = {
      ...version(2, '2026-10-18T11:35:00.000Z', null),
      model_version: 'none@0.0.0',
      inputs: null,
    };
    const text = receipt('en', none, KICKOFF, 'Europe/London', false);
    expect(text).not.toContain('none@');
    expect(text).toMatch(/^v2 computed 18 Oct, 12:35 UK time, 5 days before kick-off · /);
  });

  it('is the model’s card alone: no founder, no community', () => {
    expect(card('finished')).not.toMatch(/founder|community/i);
  });
});

// ---------------------------------------------------------------------------
// The live match centre
// ---------------------------------------------------------------------------

const empty = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
const incident = (
  minute: number,
  kind: MatchIncident['kind'],
  side: 'home' | 'away',
  name: string,
): MatchIncident => ({
  id: `${kind}-${minute}`,
  sequence: minute,
  minute,
  added_time: null,
  kind,
  side,
  player: { id: `p-${name}`, name },
  related_player: null,
  detail: null,
});
const centre = (over: Partial<MatchCentre['fixture']> = {}, rest: Partial<MatchCentre> = {}) =>
  ({
    fixture: {
      id: 'f1',
      kickoff_at: KICKOFF,
      status: 'live',
      minute: 11,
      competition: { id: 'c', name: 'Serie A', short_name: null, country_id: null },
      season: { id: 's', label: '2026/27' },
      stage: null,
      round: null,
      group_name: null,
      leg: null,
      home: team('h', 'Lazio'),
      away: team('a', 'Parma'),
      scores: {
        current: { home: 0, away: 0 },
        half_time: null,
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
      last_updated_at: '2026-10-24T11:41:00.000Z',
      freshness: null,
      ...over,
    },
    timeline: { coverage: 'available', last_updated_at: null, data: [] },
    statistics: empty,
    lineups: empty,
    availability: empty,
    player_statistics: empty,
    player_expected_goals: { ...empty, source: 'highlightly', unplaced: 0 },
    form: { home: empty, away: empty },
    head_to_head: empty,
    coverage: {
      scores: 'available',
      incidents: 'available',
      lineups: 'available',
      statistics: 'available',
      standings: 'available',
      availability: 'available',
      advanced_statistics: 'not_supplied',
    },
    ...rest,
  }) as MatchCentre;
const view = (c: MatchCentre, now?: number, locale = 'en') =>
  renderToStaticMarkup(
    <MatchCentreView
      words={matchWords(locale)}
      centre={c}
      timeZone="Europe/London"
      locale={locale}
      now={now}
    />,
  );
const section = (html: string, testId: string) => {
  const start = html.indexOf(`data-testid="${testId}"`);
  return html.slice(start, html.indexOf('</section>', start));
};

describe('live', () => {
  it('says "Not in yet" for statistics the feed has not sent, and that nothing is estimated', () => {
    const stats = section(view(centre()), 'statistics');
    expect(stats).toContain('data-testid="not-in-yet"');
    expect(stats).toContain('Not in yet');
    expect(stats).toContain(EN['matchCentre.notInYetWhy']);
    expect(stats).not.toContain('data-coverage-badge');
    // After full time the same gap is the coverage state, not a wait.
    const done = section(
      view(
        centre({
          status: 'finished',
          minute: null,
          scores: { ...centre().fixture.scores, full_time: { home: 0, away: 0 } },
        }),
      ),
      'statistics',
    );
    expect(done).not.toContain('not-in-yet');
    expect(done).toContain('data-coverage-badge="not_supplied"');
  });

  it('carries the live badge, the minute along the match and the freshness stamp', () => {
    const html = view(centre(), Date.parse('2026-10-24T11:41:10.000Z'));
    expect(html).toMatch(/data-testid="live-badge" data-live="true"><span data-live-badge=""/);
    expect(html).toMatch(/inline-size:12\.2/);
    expect(html).not.toContain('data-testid="feed-behind"');
  });

  it('says "HT" at the half-time interval, never a minute that looks stalled (T-1551)', () => {
    const at = Date.parse('2026-10-24T11:41:10.000Z');
    const html = view(centre({ minute: 45, at_half_time: true }), at);
    expect(html).toMatch(/data-testid="match-status">HT</);
    expect(html).not.toMatch(/data-testid="match-status">45′</);
    // The second half: the minute again.
    expect(view(centre({ minute: 46, at_half_time: false }), at)).toMatch(
      /data-testid="match-status">46′</,
    );
    // Persian.
    const fa = view(centre({ minute: 45, at_half_time: true }), at, 'fa');
    expect(fa).not.toMatch(/data-testid="match-status">[۴4][۵5]/);
  });

  it('says when the feed has fallen behind, in the warning colour, never as current (rule 4)', () => {
    const html = view(centre(), Date.parse('2026-10-24T12:30:00.000Z'));
    // No live badge while the feed may be behind: amber words instead.
    expect(html).toMatch(
      /data-testid="live-badge" data-live="false"><span class="[^"]*bg-warning\/15[^"]*text-warning">/,
    );
    expect(html).not.toContain('data-live-badge');
    expect(html).not.toContain('live-dot');
    expect(html).toContain('data-testid="feed-behind"');
    expect(html).toContain('The data for this match is behind');
  });

  it('lists events latest first while the match is on, in order after full time', () => {
    const events = [
      incident(6, 'goal', 'home', 'N. Jackson'),
      incident(32, 'yellow_card', 'away', 'M. Guéhi'),
      incident(52, 'goal', 'away', 'E. Haaland'),
    ];
    const timeline = { coverage: 'available' as const, last_updated_at: null, data: events };
    const live = section(view(centre({}, { timeline })), 'timeline');
    expect(live.indexOf('E. Haaland')).toBeLessThan(live.indexOf('N. Jackson'));
    const done = section(
      view(centre({ status: 'finished', minute: null }, { timeline })),
      'timeline',
    );
    expect(done.indexOf('N. Jackson')).toBeLessThan(done.indexOf('E. Haaland'));
    // From 768px each side's events in its own column.
    expect(done).toMatch(/data-side="away"[^>]*>[^]*?md:col-start-3/);
  });

  it('draws goals and cards on the axis, home above the line and away below', () => {
    const timeline = {
      coverage: 'available' as const,
      last_updated_at: null,
      data: [
        incident(6, 'goal', 'home', 'N. Jackson'),
        incident(54, 'yellow_card', 'away', 'J. Manzambi'),
        incident(59, 'substitution', 'home', 'Alysson'),
      ],
    };
    const axis = section(view(centre({}, { timeline })), 'timeline');
    expect(axis).toContain('role="img"');
    expect(axis).toContain('goals: 1, cards: 1');
    expect(axis).toMatch(/data-kind="goal" data-side="home" class="[^"]*top-4\.5 bg-accent/);
    expect(axis).toMatch(/data-kind="yellow_card" data-side="away" class="[^"]*top-12\.75/);
    expect(axis).not.toMatch(/data-kind="substitution"/);
    // The goal at 6′ of 90.
    expect(axis).toContain('inset-inline-start:6.666');
  });

  it('writes each side’s scorers under its name, and none when an own goal is in the list', () => {
    const goals = [
      incident(6, 'goal', 'home', 'N. Jackson'),
      incident(60, 'goal', 'home', 'N. Jackson'),
      incident(52, 'penalty_goal', 'away', 'E. Haaland'),
    ];
    const html = view(
      centre({}, { timeline: { coverage: 'available', last_updated_at: null, data: goals } }),
    );
    expect(html).toContain('data-testid="scorers-home">N. Jackson 6′, 60′<');
    expect(html).toContain('data-testid="scorers-away">E. Haaland 52′<');
    const own = view(
      centre(
        {},
        {
          timeline: {
            coverage: 'available',
            last_updated_at: null,
            data: [...goals, incident(70, 'own_goal', 'away', 'R. Dias')],
          },
        },
      ),
    );
    expect(own).not.toContain('data-testid="scorers-');
  });
});

describe('the match centre review (T-1550)', () => {
  const kicks = [
    incident(30, 'goal', 'home', 'Mauricio'),
    { ...incident(91, 'penalty_goal', 'home', 'G. Gómez'), id: 'k1', sequence: 91 },
    { ...incident(92, 'penalty_goal', 'away', 'T. Silva'), id: 'k2', sequence: 92 },
    { ...incident(93, 'penalty_missed', 'away', 'Hércules'), id: 'k3', sequence: 93 },
  ];

  it('names the scorers of play only: a shoot-out’s kicks are not goals', () => {
    const html = view(
      centre(
        {
          status: 'finished',
          minute: null,
          scores: {
            ...centre().fixture.scores,
            current: { home: 1, away: 0 },
            full_time: { home: 1, away: 0 },
            penalties: { home: 1, away: 1 },
          },
        },
        { timeline: { coverage: 'available', last_updated_at: null, data: kicks } },
      ),
    );
    expect(html).toContain('data-testid="scorers-home">Mauricio 30′<');
    expect(html).not.toContain('G. Gómez 91′');
    expect(html).not.toContain('data-testid="scorers-away"');
  });

  it('before kick-off says a covered module starts then, never "not supplied" (rule 3)', () => {
    const html = view(centre({ status: 'scheduled', minute: null }, { timeline: empty }));
    for (const id of ['timeline', 'statistics']) {
      const card = section(html, id);
      expect(card).toContain('data-not-yet="kickoff"');
      expect(card).toContain(EN['matchCentre.fromKickoff']);
      expect(card).toContain(EN['matchCentre.fromKickoffWhy']);
      expect(card).not.toContain(EN['matchCentre.moduleNotSupplied']);
    }
    // A module the season does not cover stays "not supplied".
    const players = section(html, 'player-statistics');
    expect(players).not.toContain('data-not-yet');
    expect(players).toContain('data-coverage-badge="not_supplied"');
    // The line-ups keep their own sentence, under the kick-off badge.
    const lineups = section(html, 'lineups');
    expect(lineups).toContain('data-not-yet="kickoff"');
    expect(lineups).toContain(EN['matchCentre.lineupsNotYet']);
  });

  it('a postponed match says it was not played, in Persian too', () => {
    const postponed = centre({ status: 'postponed', minute: null }, { timeline: empty });
    const card = section(view(postponed), 'timeline');
    expect(card).toContain('data-not-yet="unplayed"');
    expect(card).toContain(EN['matchCentre.notPlayedWhy']);
    expect(section(view(postponed, undefined, 'fa'), 'statistics')).toContain('برگزار نشد');
  });

  it('once played, a missing module is its coverage state again', () => {
    const done = section(view(centre({ status: 'finished', minute: null })), 'statistics');
    expect(done).not.toContain('data-not-yet');
    expect(done).toContain('data-coverage-badge="not_supplied"');
  });
});

// ---------------------------------------------------------------------------
// Ratings: on the pitch and the best rated
// ---------------------------------------------------------------------------

let next = 0;
const starter = (position: MatchLineupPlayer['position']): MatchLineupPlayer => {
  next += 1;
  return {
    id: `p${next}`,
    name: `Player ${next}`,
    role: 'starter',
    shirt_number: next,
    position,
    is_captain: false,
    grid: null,
  };
};
const eleven = () => [
  starter('goalkeeper'),
  ...Array.from({ length: 4 }, () => starter('defender')),
  ...Array.from({ length: 4 }, () => starter('midfielder')),
  ...Array.from({ length: 2 }, () => starter('forward')),
];

describe('ratings', () => {
  it('draws a rating on the Design System chip, in the reader’s digits (T-1523)', () => {
    const home = eleven();
    const html = (locale: 'en' | 'fa') =>
      renderToStaticMarkup(
        <MatchLineupsView
          home={team('h', 'Aston Villa')}
          away={team('a', 'Leeds')}
          lineups={{ home, away: eleven() }}
          ratings={new Map([[home[0]!.id, 7]])}
          locale={locale}
          words={matchWords(locale)}
        />,
      );
    expect(html('en')).toMatch(/data-rating-band="good" class="[^"]*">7\.0</);
    expect(html('fa')).toMatch(/data-rating-band="good" class="[^"]*">۷٫۰</);
  });

  it('puts the ratings on the pitch, the best rated in saffron, and turns it from 768px', () => {
    const home = eleven();
    const away = eleven();
    const ratings = new Map([
      [home[10]!.id, 8.9],
      [away[0]!.id, 5.7],
    ]);
    const html = renderToStaticMarkup(
      <MatchLineupsView
        home={team('h', 'Aston Villa')}
        away={team('a', 'Manchester City')}
        lineups={{ home, away }}
        ratings={ratings}
        locale="en"
        words={matchWords('en')}
      />,
    );
    // One pitch: stacked on a phone, horizontal from 768px, home from the start.
    expect(html).toMatch(/data-testid="lineup-pitch"[^>]*/);
    expect(html).toMatch(
      /class="relative flex flex-col[^"]*md:flex-row-reverse[^"]*" data-testid="lineup-pitch"/,
    );
    expect(html).toMatch(/data-rating-band="top" class="[^"]*">8\.9</);
    expect(html).toMatch(/data-rating-band="low" class="[^"]*">5\.7</);
    expect(html.match(/data-rating-band=/g)).toHaveLength(2);
    expect(html).toContain(`bg-accent text-on-accent">${home[10]!.shirt_number}<`);
  });

  it('names the best rated with the best six, from the feed’s ratings only', () => {
    const stats = [6.1, 8.9, 7.7, 7.6, 7.5, 7.1, 7.0, 0].map((rating, i) => ({
      id: `s${i}`,
      name: `Rated ${i}`,
      side: (i % 2 === 0 ? 'home' : 'away') as 'home' | 'away',
      stats: i === 7 ? { minutes: 0, rating: 6 } : { minutes: 90, rating, goals: i === 1 ? 2 : 0 },
    }));
    const c = centre(
      { status: 'finished', minute: null },
      { player_statistics: { coverage: 'available', last_updated_at: null, data: stats } },
    );
    // A substitute who never came on has no rating to show (rule 3).
    expect([...ratingsOf(c).keys()]).not.toContain('s7');
    const html = section(view(c), 'top-rated');
    expect(html).toContain('Top rated');
    expect(html).toMatch(/Rated 1<\/a>[^]*data-rating-band="top"/);
    const best = [...html.matchAll(/data-rating-band="\w+" class="[^"]*">([\d.]+)</g)].map(
      (m) => m[1],
    );
    expect(best).toEqual(['8.9', '8.9', '7.7', '7.6', '7.5', '7.1', '7.0']);
    // Nothing rated, no card.
    expect(view(centre())).not.toContain('data-testid="top-rated"');
  });
});
