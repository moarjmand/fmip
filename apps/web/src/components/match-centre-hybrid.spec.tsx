import type {
  CommunityConsensusResponse,
  FixtureEvaluationsResponse,
  ForecastEvaluation,
  ForecastVersion,
  ForecastVersionsResponse,
  FounderAnalysisResponse,
  MatchCentre,
  MatchIncident,
  MatchLineupPlayer,
  MatchStatRow,
  MatchViewing,
} from '@fmip/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EN } from '@/i18n/messages';
import { gridLines, pitchLines, pitchShape } from '@/lib/formation';
import { matchWords } from '@/lib/words-server';
import { ForecastReality } from '@/app/[locale]/match/[id]/forecast-reality';
import { CommunityForecastPanel, CommunityPicksRow } from './community-consensus';
import { FounderAnalysisPanel } from './founder-analysis';
import { MatchCentreView } from './match-centre-view';
import { KeyEvents } from './match-key-events';
import { liveSlots } from './match-live-slots';
import { MatchLineups, MatchStats, STAT_GROUPS, statGroups } from './match-stats-panels';
import { STAT_KEY } from '@/lib/match';
import { MatchLineupsView } from './match-lineups';
import { HighlightsLink, WatchLine } from './viewing-panel';

/**
 * The Hybrid match centre (T-1384, D-202): the score band before, during and
 * after a match, the line-ups on a pitch only where the feed places every
 * starter, the phone's tabs, where to watch under the score, and after full
 * time each of the three products against the result, in its own place.
 */

// ---------------------------------------------------------------------------
// The pitch: placed from the formation and the roles, never invented
// ---------------------------------------------------------------------------

let next = 0;
const player = (
  position: MatchLineupPlayer['position'],
  over: Partial<MatchLineupPlayer> = {},
): MatchLineupPlayer => {
  next += 1;
  return {
    id: `p${next}`,
    name: `Player ${next}`,
    role: 'starter',
    shirt_number: next,
    position,
    is_captain: false,
    grid: null,
    ...over,
  };
};
const eleven = (d: number, m: number, f: number): MatchLineupPlayer[] => [
  player('goalkeeper'),
  ...Array.from({ length: d }, () => player('defender')),
  ...Array.from({ length: m }, () => player('midfielder')),
  ...Array.from({ length: f }, () => player('forward')),
];

describe('where the starters stand (pitchLines)', () => {
  it('fills a three-line formation from the roles, goalkeeper first', () => {
    const lines = pitchLines('4-3-3', [...eleven(4, 3, 3), player('defender', { role: 'bench' })]);
    expect(lines.state).toBe('pitch');
    if (lines.state !== 'pitch') return;
    expect(lines.lines.map((line) => line.length)).toEqual([1, 4, 3, 3]);
    expect(lines.lines[0]?.[0]?.position).toBe('goalkeeper');
  });

  it('will not split the midfield of a four-line formation: it does not know who stood where', () => {
    expect(pitchLines('4-2-3-1', eleven(4, 5, 1))).toEqual({
      state: 'lines_unknown',
      formation: '4-2-3-1',
    });
  });

  it('says why when the formation, a role or the counts are missing or wrong', () => {
    expect(pitchLines(null, eleven(4, 4, 2)).state).toBe('no_formation');
    expect(pitchLines('4 4 2', eleven(4, 4, 2)).state).toBe('no_formation');
    const noRole = eleven(4, 4, 2);
    noRole[5] = { ...noRole[5]!, position: null };
    expect(pitchLines('4-4-2', noRole).state).toBe('no_roles');
    // T-1714: ten named starters read as ten, before the formation is looked at.
    expect(pitchLines('4-4-2', eleven(4, 4, 1))).toEqual({ state: 'short', count: 10 });
    expect(pitchLines(null, eleven(4, 4, 1)).state).toBe('short');
    expect(pitchLines('4-4-2', eleven(5, 3, 2))).toEqual({ state: 'mismatch', formation: '4-4-2' });
    expect(pitchLines('4-4-3', eleven(4, 4, 2)).state).toBe('mismatch');
  });
});

const team = (id: string, name: string, formation: string | null) => ({
  id,
  name,
  short_name: null,
  code: null,
  formation,
  coach: id === 'h' ? { id: 'c', name: 'Dragan Skočić' } : null,
});

describe('the line-ups on a pitch', () => {
  const words = matchWords('en');
  const render = (homeFormation: string | null, awayFormation: string | null, locale = 'en') =>
    renderToStaticMarkup(
      <MatchLineupsView
        home={team('h', 'Tractor', homeFormation)}
        away={team('a', 'Esteghlal', awayFormation)}
        lineups={{
          home: [...eleven(4, 3, 3), player('forward', { role: 'bench', name: 'Sub Home' })],
          away: eleven(4, 5, 1),
        }}
        locale={locale}
        words={locale === 'en' ? words : matchWords(locale)}
      />,
    );

  it('draws both halves, away at the top and home at the bottom, each goalkeeper at its own goal', () => {
    const html = renderToStaticMarkup(
      <MatchLineupsView
        home={team('h', 'Tractor', '4-3-3')}
        away={team('a', 'Esteghlal', '4-4-2')}
        lineups={{ home: eleven(4, 3, 3), away: eleven(4, 4, 2) }}
        locale="en"
        words={words}
      />,
    );
    expect(html).toContain('data-sides="away home"');
    expect(html.indexOf('data-testid="pitch-away"')).toBeLessThan(
      html.indexOf('data-testid="pitch-home"'),
    );
    const away = html.slice(
      html.indexOf('data-testid="pitch-away"'),
      html.indexOf('data-testid="pitch-home"'),
    );
    const home = html.slice(html.indexOf('data-testid="pitch-home"'));
    // Away: goalkeeper's row first (a row of one), then four, four, two.
    expect(
      [...away.matchAll(/<ol class="flex justify-around py-1.5[^"]*">(.*?)<\/ol>/g)].map(
        (m) => (m[1] ?? '').split('<li').length - 1,
      ),
    ).toEqual([1, 4, 4, 2]);
    // Home: forwards first, goalkeeper last.
    expect(
      [...home.matchAll(/<ol class="flex justify-around py-1.5[^"]*">(.*?)<\/ol>/g)].map(
        (m) => (m[1] ?? '').split('<li').length - 1,
      ),
    ).toEqual([3, 3, 4, 1]);
    expect(html).toContain(
      'aria-label="Line-ups on the pitch: Tractor and Esteghlal, each goalkeeper at his own goal"',
    );
    expect(html).toContain(EN['matchCentre.lineups.pitchNote']);
    // Every name still goes to the player page.
    expect(html).toContain('href="/en/player/');
    expect(html).not.toMatch(/data-testid="lineup-fallback"/);
  });

  it('falls back to a list for a side it cannot place, and says why', () => {
    const html = render('4-3-3', '4-2-3-1');
    expect(html).toContain('data-sides="home"');
    expect(html).toContain('data-testid="lineup-list-away"');
    expect(html).toContain('data-reason="lines_unknown"');
    expect(html).toContain(
      'The line-up does not say which midfielder played in which line of the ⁦4-2-3-1⁩, so it is shown as a list.',
    );
    const both = render(null, null);
    expect(both).not.toContain('data-testid="lineup-pitch"');
    expect(both.match(/data-reason="no_formation"/g)).toHaveLength(2);
  });

  it('says a side of ten names ten of the eleven, never that a role is missing (T-1714)', () => {
    const html = renderToStaticMarkup(
      <MatchLineupsView
        home={team('h', 'Tractor', '4-3-3')}
        away={team('a', 'Esteghlal', '4-4-2')}
        lineups={{ home: eleven(4, 3, 3), away: eleven(4, 4, 1) }}
        locale="en"
        words={words}
      />,
    );
    expect(html).toContain('data-testid="lineup-list-away"');
    expect(html).toContain('data-reason="short"');
    expect(html).toContain('Only 10 of the eleven starters are named');
  });

  it('keeps the bench and the coach for each side, and says when a coach is not supplied', () => {
    const html = render('4-3-3', '4-5-1');
    const benches = html.slice(html.indexOf('data-testid="lineup-benches"'));
    // A full name in the same style as the feed's short ones (T-1395).
    expect(benches).toContain('S. Home');
    expect(benches).toContain('Coach: Dragan Skočić');
    expect(benches).toContain('Coach: not supplied');
  });

  it('says it in Persian, the formation kept left to right inside the sentence', () => {
    const html = render('4-3-3', '4-2-3-1', 'fa');
    expect(html).toContain('داده‌ها نمی‌گویند هر هافبک در کدام خطِ آرایش ⁦4-2-3-1⁩ بازی کرد');
    expect(html).toContain('ترکیب‌ها در زمین: Tractor و Esteghlal');
    expect(html).not.toContain('data-translation="untranslated"');
  });

  it('says a line-up with nobody in it is not supplied, rather than two empty lists', () => {
    const html = renderToStaticMarkup(
      <MatchLineupsView
        home={team('h', 'Tractor', '4-3-3')}
        away={team('a', 'Esteghlal', null)}
        lineups={{ home: [], away: [] }}
        locale="en"
        words={words}
      />,
    );
    expect(html).toContain('data-testid="lineup-empty"');
    expect(html).toContain('Not supplied for this match.');
    expect(html).not.toContain('<ul');
  });
});

// ---------------------------------------------------------------------------
// The pitch from the line-up's own places (T-1397, D-212)
// ---------------------------------------------------------------------------

/**
 * Eleven starters at the places a line-up gives them: `rows` is how many
 * stand on each line after the goalkeeper's ("4-2-3-1" is [4, 2, 3, 1]); the
 * names say where each stands ("r3c2" is row 3, column 2), and the roles are
 * a 4-2-3-1's or a 3-4-2-1's (two midfield lines, which the roles alone
 * cannot place).
 */
const placed = (rows: number[], roles: MatchLineupPlayer['position'][]): MatchLineupPlayer[] => {
  const out: MatchLineupPlayer[] = [
    player('goalkeeper', { name: 'r1c1', grid: { row: 1, col: 1 } }),
  ];
  let index = 0;
  rows.forEach((count, line) => {
    for (let col = 1; col <= count; col += 1) {
      out.push(
        player(roles[index] ?? null, {
          name: `r${line + 2}c${col}`,
          grid: { row: line + 2, col },
        }),
      );
      index += 1;
    }
  });
  return out;
};
const D = 'defender' as const;
const M = 'midfielder' as const;
const F = 'forward' as const;
const fourTwoThreeOne = () => placed([4, 2, 3, 1], [D, D, D, D, M, M, M, M, M, F]);
const threeFourTwoOne = () => placed([3, 4, 2, 1], [D, D, D, M, M, M, M, M, M, F]);

describe("where the starters stand by the line-up's places (gridLines)", () => {
  const names = (lines: MatchLineupPlayer[][]) => lines.map((line) => line.map((p) => p.name));

  it('draws a 4-2-3-1 line by line, each line from the left as the side attacks', () => {
    const shape = pitchShape('4-2-3-1', fourTwoThreeOne().reverse());
    expect(shape.state).toBe('pitch');
    if (shape.state !== 'pitch') return;
    expect(shape.by).toBe('grid');
    expect(shape.formation).toBe('4-2-3-1');
    expect(names(shape.lines)).toEqual([
      ['r1c1'],
      ['r2c1', 'r2c2', 'r2c3', 'r2c4'],
      ['r3c1', 'r3c2'],
      ['r4c1', 'r4c2', 'r4c3'],
      ['r5c1'],
    ]);
  });

  it('draws a 3-4-2-1 the roles alone could not place', () => {
    expect(pitchLines('3-4-2-1', threeFourTwoOne()).state).toBe('lines_unknown');
    const shape = pitchShape('3-4-2-1', threeFourTwoOne());
    expect(shape.state === 'pitch' && shape.lines.map((line) => line.length)).toEqual([
      1, 3, 4, 2, 1,
    ]);
  });

  it('needs no formation string, and keeps none it was not given', () => {
    const shape = gridLines(null, fourTwoThreeOne());
    expect(shape?.formation).toBeNull();
    expect(shape?.lines.map((line) => line.length)).toEqual([1, 4, 2, 3, 1]);
  });

  it('uses the places only when they are whole, else the roles, else a list', () => {
    const missing = fourTwoThreeOne();
    missing[7] = { ...missing[7]!, grid: null };
    expect(gridLines('4-2-3-1', missing)).toBeNull();
    // Without every place, a 4-2-3-1 is still the list it was (T-1384).
    expect(pitchShape('4-2-3-1', missing)).toEqual({
      state: 'lines_unknown',
      formation: '4-2-3-1',
    });

    const shared = fourTwoThreeOne();
    shared[3] = { ...shared[3]!, grid: { row: 2, col: 1 } };
    expect(gridLines('4-2-3-1', shared)).toBeNull();

    const keeperOut = fourTwoThreeOne();
    keeperOut[0] = { ...keeperOut[0]!, position: 'defender' };
    expect(gridLines('4-2-3-1', keeperOut)).toBeNull();

    const twoOnTheLine = fourTwoThreeOne();
    twoOnTheLine[1] = { ...twoOnTheLine[1]!, grid: { row: 1, col: 2 } };
    expect(gridLines(null, twoOnTheLine)).toBeNull();

    // The places say 4-2-3-1 and the formation 4-4-2: one of them is wrong.
    expect(gridLines('4-4-2', fourTwoThreeOne())).toBeNull();
    expect(gridLines('4-2-3-1', fourTwoThreeOne().slice(0, 10))).toBeNull();

    // A line-up of a three-line formation with places is drawn by them.
    const threeLines = placed([4, 3, 3], [D, D, D, D, M, M, M, F, F, F]);
    expect(pitchShape('4-3-3', threeLines)).toMatchObject({ state: 'pitch', by: 'grid' });
    // And without them, by the roles, as before.
    expect(pitchShape('4-3-3', eleven(4, 3, 3))).toMatchObject({ state: 'pitch', by: 'roles' });
  });

  it('reads a line-up stored before places were kept (no field at all) as without places', () => {
    const old = fourTwoThreeOne().map(({ grid: _grid, ...rest }) => rest as MatchLineupPlayer);
    expect(gridLines('4-2-3-1', old)).toBeNull();
  });
});

describe("the pitch from the line-up's places", () => {
  const words = matchWords('en');
  const rowsOf = (html: string, side: 'away' | 'home') => {
    const start = html.indexOf(`data-testid="pitch-${side}"`);
    const end = side === 'away' ? html.indexOf('data-testid="pitch-home"') : html.length;
    return [
      ...html
        .slice(start, end)
        .matchAll(/<ol dir="ltr" class="flex justify-around py-1.5[^"]*">(.*?)<\/ol>/g),
    ].map((m) => [...(m[1] ?? '').matchAll(/title="(r\dc\d)"/g)].map((n) => n[1]));
  };
  const render = (locale: string, home = fourTwoThreeOne(), away = threeFourTwoOne()) =>
    renderToStaticMarkup(
      <MatchLineupsView
        home={team('h', 'Tractor', '4-2-3-1')}
        away={team('a', 'Esteghlal', '3-4-2-1')}
        lineups={{ home, away }}
        locale={locale}
        words={locale === 'en' ? words : matchWords(locale)}
      />,
    );

  it('draws both sides of two-midfield-line formations, home from its own left, away mirrored', () => {
    const html = render('en');
    expect(html).toContain('data-sides="away home"');
    expect(html).not.toMatch(/data-testid="lineup-fallback"/);
    expect(html.match(/data-placed-by="grid"/g)).toHaveLength(2);
    // Home attacks up the screen: goalkeeper's line last, its left on the left.
    expect(rowsOf(html, 'home')).toEqual([
      ['r5c1'],
      ['r4c1', 'r4c2', 'r4c3'],
      ['r3c1', 'r3c2'],
      ['r2c1', 'r2c2', 'r2c3', 'r2c4'],
      ['r1c1'],
    ]);
    // Away attacks down the screen: goalkeeper's line first, its left on the right.
    expect(rowsOf(html, 'away')).toEqual([
      ['r1c1'],
      ['r2c3', 'r2c2', 'r2c1'],
      ['r3c4', 'r3c3', 'r3c2', 'r3c1'],
      ['r4c2', 'r4c1'],
      ['r5c1'],
    ]);
    expect(html).toContain(EN['matchCentre.lineups.pitchNoteGrid']);
    expect(html).not.toContain(EN['matchCentre.lineups.pitchNote']);
    // The formations are still named beside each side.
    expect(html).toContain('>4-2-3-1</span>');
    expect(html).toContain('>3-4-2-1</span>');
  });

  it('keeps the left and right of the ground on a right-to-left page', () => {
    const en = render('en');
    const fa = render('fa');
    expect(rowsOf(fa, 'home')).toEqual(rowsOf(en, 'home'));
    expect(rowsOf(fa, 'away')).toEqual(rowsOf(en, 'away'));
    expect(fa).toContain('در خطِ خودش');
    expect(fa).not.toContain('data-translation="untranslated"');
  });

  it('names which side is placed how when one has places and the other only roles', () => {
    const html = renderToStaticMarkup(
      <MatchLineupsView
        home={team('h', 'Tractor', '4-2-3-1')}
        away={team('a', 'Esteghlal', '4-4-2')}
        lineups={{ home: fourTwoThreeOne(), away: eleven(4, 4, 2) }}
        locale="en"
        words={words}
      />,
    );
    expect(html).toContain('data-sides="away home"');
    expect(html).toMatch(/data-testid="pitch-away" data-placed-by="roles"/);
    expect(html).toMatch(/data-testid="pitch-home" data-placed-by="grid"/);
    expect(html).toContain(
      '⁨Tractor⁩: each player where the line-up places him. ⁨Esteghlal⁩: placed by the formation',
    );
  });

  it('falls back to the list, with its reason, when a place is missing', () => {
    const home = fourTwoThreeOne();
    home[4] = { ...home[4]!, grid: null };
    const html = render('en', home);
    expect(html).toContain('data-sides="away"');
    expect(html).toContain('data-testid="lineup-list-home"');
    expect(html).toContain('data-reason="lines_unknown"');
  });
});

// ---------------------------------------------------------------------------
// The score band before, during and after the match
// ---------------------------------------------------------------------------

const empty = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
const centre = (fixture: Partial<MatchCentre['fixture']>): MatchCentre => ({
  fixture: {
    id: '00000000-0000-4000-8000-000000000901',
    kickoff_at: '2026-10-08T13:30:00.000Z',
    status: 'live',
    minute: 78,
    competition: { id: 'c', name: 'Persian Gulf Pro League', short_name: null, country_id: null },
    season: { id: 's', label: '2026/27' },
    stage: null,
    round: null,
    group_name: null,
    leg: null,
    home: team('h', 'Tractor', null),
    away: team('a', 'Esteghlal', null),
    scores: {
      current: { home: 2, away: 1 },
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
    last_updated_at: '2026-10-08T14:50:00.000Z',
    freshness: null,
    ...fixture,
  },
  timeline: empty,
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
    lineups: 'limited',
    statistics: 'delayed',
    standings: 'limited',
    availability: 'not_supplied',
    advanced_statistics: 'not_supplied',
  },
});
const band = (c: MatchCentre, locale = 'en', hero = {}) => {
  const html = renderToStaticMarkup(
    <MatchCentreView
      words={matchWords(locale)}
      centre={c}
      timeZone="Asia/Tehran"
      locale={locale}
      hero={hero}
    />,
  );
  return html.slice(0, html.indexOf('</header>'));
};

describe('per-player expected goals (T-1432)', () => {
  // As the page draws a finished match: its Stats cards are the server's,
  // through the view's `matchStats` slot (T-1800..T-1802).
  const view = (
    expected: MatchCentre['player_expected_goals'],
    locale = 'en',
    statistics: MatchCentre['statistics'] = centre({}).statistics,
  ) => {
    const c = { ...centre({ status: 'finished' }), player_expected_goals: expected, statistics };
    const words = matchWords(locale);
    return renderToStaticMarkup(
      <MatchCentreView
        words={words}
        centre={c}
        timeZone="UTC"
        locale={locale}
        slots={{ matchStats: <MatchStats centre={c} locale={locale} words={words} /> }}
      />,
    );
  };
  const card = (html: string) => {
    const at = html.indexOf('data-testid="player-expected-goals"');
    return at < 0 ? '' : html.slice(at, html.indexOf('</section>', at));
  };

  it('shows a card of its own, licensed data and no provider name, a dash only for what was not supplied', () => {
    const html = card(
      view({
        source: 'highlightly',
        unplaced: 3,
        coverage: 'limited',
        last_updated_at: '2026-10-08T16:00:00.000Z',
        data: [
          { id: 'p1', name: 'Mohamed Salah', side: 'home', figures: { xg: 0.38, xa: 0.12 } },
          { id: 'p2', name: 'Alisson', side: 'away', figures: { xa: 0 } },
        ],
      }),
    );
    expect(html).toContain('data-coverage="limited"');
    // D-014 (T-1802): the heading says what it is, never whose it is.
    expect(html).toContain('Expected goals by player');
    expect(html).toContain('Licensed match data');
    expect(html).not.toContain('Highlightly');
    expect(html).toContain('0.38');
    // A supplied zero is written, quiet; a missing figure is a dash the legend explains.
    expect(html).toMatch(/text-caption">0\.00</);
    expect(html).toContain('–');
    expect(html).toContain('data-testid="table-legend"');
    expect(html).toContain('– no figure supplied for this player');
    // The name column stays put while the figures scroll.
    expect(html).toMatch(/<th scope="row" class="sticky start-0[^"]*bg-surface/);
    expect(html).toContain('data-testid="player-expected-goals-unplaced"');
    expect(html).toContain('Not shown: 3 players');
  });

  it('says why it is empty rather than drawing zeros', () => {
    const answered = card(
      view({
        source: 'highlightly',
        unplaced: 0,
        coverage: 'not_supplied',
        last_updated_at: '2026-10-08T16:00:00.000Z',
        data: null,
      }),
    );
    expect(answered).toContain('No expected goals by player are supplied for this match.');
    expect(answered).not.toContain('<table');
    const owed = card(
      view({
        source: 'highlightly',
        unplaced: 0,
        coverage: 'delayed',
        last_updated_at: null,
        data: null,
      }),
    );
    expect(owed).toContain('data-coverage="delayed"');
  });

  it('orders the statistics in four fixed groups, every metric in exactly one (T-1800)', () => {
    const grouped = STAT_GROUPS.flatMap(([, metrics]) => [...metrics]);
    expect([...grouped].sort()).toEqual(Object.keys(STAT_KEY).sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    // The feed's alphabetical order, as it came; a group with nothing is left out.
    const rows: MatchStatRow[] = (
      ['blocked_shots', 'corners', 'fouls', 'possession_pct', 'shots'] as const
    ).map((metric) => ({ metric, home: 5, away: 4 }));
    const groups = statGroups(rows);
    expect(groups.map(([g, list]) => [g, list.map((r) => r.metric)])).toEqual([
      ['match', ['possession_pct']],
      ['attack', ['shots', 'blocked_shots', 'corners']],
      ['discipline', ['fouls']],
    ]);
    const html = view(
      {
        source: 'highlightly',
        unplaced: 0,
        coverage: 'not_supplied',
        last_updated_at: null,
        data: null,
      },
      'en',
      { coverage: 'available', last_updated_at: null, data: rows },
    );
    const stats = html.slice(html.indexOf('data-testid="stat-grid"'));
    expect(stats.indexOf('data-metric="possession_pct"')).toBeLessThan(
      stats.indexOf('data-metric="shots"'),
    );
    expect(stats).toContain('>Attack</');
    // Fouls: more is not better, so neither side is marked.
    expect(stats).toMatch(
      /data-metric="fouls"><div class="flex flex-col gap-1\.5" data-stat-bar="" data-lead="none"/,
    );
    expect(stats).toMatch(
      /data-metric="shots"><div class="flex flex-col gap-1\.5" data-stat-bar="" data-lead="home"/,
    );
  });

  it('agrees with the statistics when the team xG is supplied and the player breakdown is not (F9)', () => {
    const html = view(
      {
        source: 'highlightly',
        unplaced: 0,
        coverage: 'not_supplied',
        last_updated_at: '2026-10-08T16:00:00.000Z',
        data: null,
      },
      'en',
      {
        coverage: 'available',
        last_updated_at: '2026-10-08T16:00:00.000Z',
        data: [{ metric: 'expected_goals', home: 2.19, away: 1.88 }],
      },
    );
    // The statistics carry the team figure ...
    expect(html).toContain('data-metric="expected_goals"');
    expect(html).not.toContain('data-testid="xg-not-supplied"');
    // ... and the card says only the player breakdown is missing.
    expect(card(html)).toContain(
      'Per-player xG: not supplied for this match. The team figure in the statistics above is supplied',
    );
    expect(card(html)).not.toContain('No expected goals by player are supplied');
  });

  it('in play, the server’s card too, under the same neutral heading (T-1813, D-409)', () => {
    const words = matchWords('en');
    const c = centre({});
    const live = renderToStaticMarkup(
      <MatchCentreView
        words={words}
        centre={c}
        timeZone="UTC"
        locale="en"
        slots={liveSlots({ centre: c, locale: 'en', timeZone: 'UTC', words })}
      />,
    );
    const own = card(live);
    expect(own).toContain('Expected goals by player');
    expect(own).not.toContain('Highlightly');
    // The view has no card of its own any more: without the slot, none.
    const bare = renderToStaticMarkup(
      <MatchCentreView words={words} centre={c} timeZone="UTC" locale="en" />,
    );
    expect(card(bare)).toBe('');
  });
});

describe('the score band', () => {
  it('before kick-off shows the kick-off time large, and no score at all', () => {
    const html = band(
      centre({
        status: 'scheduled',
        minute: null,
        scores: { ...centre({}).fixture.scores, current: null },
      }),
    );
    // 13:30 UTC is 17:00 in Tehran.
    expect(html).toMatch(/data-testid="match-status">17:00</);
    expect(html).not.toContain('data-testid="score"');
    expect(html).not.toContain('live-dot');
  });

  it('live shows the saffron badge with the minute above the score, and the stream line under it', () => {
    const html = band(centre({}), 'en', { live: <p data-testid="live-state">STAMP</p> });
    expect(html).toMatch(
      /data-testid="live-badge" data-live="true"><span data-live-badge="" class="[^"]*text-live[^"]*"><span aria-hidden="true" class="live-dot[^"]*"><\/span><span>Live[^<]*<\/span><span data-testid="match-status">78′</,
    );
    expect(html.indexOf('data-testid="live-badge"')).toBeLessThan(
      html.indexOf('data-testid="score"'),
    );
    expect(html).toMatch(/class="[^"]*text-live[^"]*" data-testid="score"/);
    // The minute along the match, then kick-off and the stream's stamp.
    expect(html).toMatch(/data-testid="live-progress"[^]*inline-size:86\.66/);
    expect(html.indexOf('data-testid="score"')).toBeLessThan(html.indexOf('STAMP'));
  });

  it('at full time shows the full-time score and FT, and the highlight before the facts', () => {
    const html = band(
      centre({
        status: 'finished',
        minute: null,
        scores: {
          ...centre({}).fixture.scores,
          current: { home: 1, away: 1 },
          full_time: { home: 1, away: 1 },
        },
      }),
      'en',
      { highlights: <p data-testid="hero-highlights">CLIP</p> },
    );
    expect(html).toMatch(/data-testid="match-status">FT</);
    expect(html).not.toContain('text-live');
    expect(html.indexOf('CLIP')).toBeLessThan(html.indexOf('data-testid="last-update"'));
  });

  it('on /fa sets the score in Vazirmatn with Persian digits, home goals on the home side', () => {
    const html = band(centre({}), 'fa');
    expect(html).toMatch(
      /<span dir="rtl" class="[^"]*text-display-3[^"]*" data-testid="score">۲<span[^>]*>–<\/span>۱<\/span>/,
    );
    expect(html).not.toMatch(/data-testid="score"[^>]*font-stretch-condensed/);
    // The home team first in the DOM, so the grid puts it on the right.
    expect(html.indexOf('data-testid="home-team"')).toBeLessThan(
      html.indexOf('data-testid="away-team"'),
    );
    expect(html).toContain('۷۸′');
  });

  it('says that no event is recorded yet rather than drawing an empty list', () => {
    // The server's card in play since T-1812 (D-409).
    const html = renderToStaticMarkup(
      <KeyEvents
        words={matchWords('en')}
        centre={{
          ...centre({}),
          timeline: { coverage: 'available', last_updated_at: null, data: [] },
        }}
        timeZone="UTC"
        locale="en"
      />,
    );
    expect(html).toContain('data-testid="no-events"');
    expect(html).toContain('No events recorded yet.');
  });

  it('puts the stamp and the watch line under the score, full width, so the names keep their room', () => {
    const html = band(centre({}), 'en', {
      live: <p>STAMP</p>,
      watch: <p>WATCH</p>,
    });
    expect(html.indexOf('data-testid="away-team"')).toBeLessThan(html.indexOf('STAMP'));
    expect(html.indexOf('STAMP')).toBeLessThan(html.indexOf('WATCH'));
  });

  it('never paints a club colour or a lane colour on the band', () => {
    const html = band(centre({}));
    expect(html).not.toMatch(/bg-(model|founder|community)|text-(model|founder|community)/);
  });
});

describe('the phone tabs need no script (T-1384)', () => {
  const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

  it('shows the tab holding the target, else the Summary, below 768px only', () => {
    const start = css.indexOf("The match centre's tabs (T-1384");
    const block = css.slice(start, css.indexOf('Fallback faces matched', start));
    const phone = block.slice(block.indexOf('@media (width < 48rem)'), block.indexOf('\n}\n'));
    // The Summary also shows a section that names it as its second tab: the
    // pick card, a Predictions section under the model's card (T-1739, D-360).
    const also = ", \\[data-tab-also='summary'\\]";
    expect(phone).toMatch(
      new RegExp(
        `\\[data-match-tabs\\]:not\\(:has\\(\\[data-tab\\]:target, \\[data-tab\\] :target\\)\\)\\s+\\[data-tab\\]:not\\(\\[data-tab='summary'\\]${also}\\)`,
      ),
    );
    for (const tab of ['summary', 'lineups', 'stats', 'predictions', 'watch', 'discussion']) {
      // A section shows by the tab it names, so a tab may hold sections in both columns.
      expect(phone).toMatch(
        new RegExp(
          `\\[data-match-tabs\\]:has\\(\\[data-tab='${tab}'\\]:target, \\[data-tab='${tab}'\\] :target\\)\\s+\\[data-tab\\]:not\\(\\[data-tab='${tab}'\\]${tab === 'summary' ? also : ''}\\)`,
        ),
      );
      // The tab on show is marked at every width.
      expect(block.slice(block.indexOf('\n}\n'))).toContain(`[data-tab-link='${tab}']`);
    }
  });
});

// ---------------------------------------------------------------------------
// Where to watch, and the highlight
// ---------------------------------------------------------------------------

const viewing = (over: Partial<MatchViewing> = {}): MatchViewing => ({
  fixture_id: 'f1',
  territory: { state: 'chosen', territory: { code: 'IR', name: 'Iran' } },
  options: empty,
  highlights: empty,
  ...over,
});
const option = (id: string, name: string, access: 'free' | 'registration' = 'free') => ({
  id: `${id}-${access}`,
  broadcaster: { id, name, homepage_url: null, kind: 'tv' as const },
  access,
  url: `https://${id}.example/live`,
  territory: 'IR',
  source: { id: 's', name: 'Desk', rights: 'link' as const },
  from_default: false,
  last_updated_at: '2026-10-08T07:00:00.000Z',
});

describe('where to watch under the score', () => {
  it('names each service once, as a link-out to its own page', () => {
    const html = renderToStaticMarkup(
      <WatchLine
        locale="en"
        viewing={viewing({
          options: {
            coverage: 'available',
            last_updated_at: '2026-10-08T07:00:00.000Z',
            data: [
              option('tv3', 'IRIB TV3'),
              option('tw', 'Telewebion'),
              option('tw', 'Telewebion', 'registration'),
            ],
          },
        })}
      />,
    );
    expect(html).toContain('Watch:');
    expect(html.match(/data-link-out="/g)).toHaveLength(2);
    expect(html).toContain('href="https://tv3.example/live"');
    expect(html).toContain('data-link-out="Telewebion"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('sends the reader to the Watch section when nothing is listed, and says nothing when unreachable', () => {
    const ask = renderToStaticMarkup(
      <WatchLine locale="en" viewing={viewing({ territory: { state: 'not_chosen' } })} />,
    );
    expect(ask).toContain('href="#watch"');
    expect(ask).toContain('data-state="ask"');
    expect(ask).not.toContain('data-link-out');
    expect(renderToStaticMarkup(<WatchLine locale="en" viewing={null} />)).toBe('');
  });

  it('puts the official highlight first after full time, naming its publisher or its site', () => {
    const clip = (publisher: string | null) =>
      renderToStaticMarkup(
        <HighlightsLink
          locale="en"
          viewing={viewing({
            highlights: {
              coverage: 'available',
              last_updated_at: '2026-10-08T17:00:00.000Z',
              data: [
                {
                  id: 'h1',
                  kind: 'official_page',
                  url: 'https://www.telewebion.com/clip/1',
                  embed_url: null,
                  thumbnail_url: null,
                  territory: 'IR',
                  source: { id: 's', name: 'Desk', rights: 'link' },
                  publisher,
                  last_updated_at: '2026-10-08T17:00:00.000Z',
                },
              ],
            },
          })}
        />,
      );
    expect(clip('Persian Gulf Pro League')).toContain(
      'Official highlights (<bdi>Persian Gulf Pro League</bdi>)',
    );
    expect(clip(null)).toContain('data-link-out="telewebion.com"');
    expect(clip(null)).toContain(
      'Highlights open on telewebion.com&#x27;s site. We don&#x27;t host video.',
    );
    expect(renderToStaticMarkup(<HighlightsLink locale="en" viewing={viewing()} />)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// What was forecast, and what happened: three lanes, three components
// ---------------------------------------------------------------------------

const version = (n: number, computedAt: string): ForecastVersion => ({
  id: `v${n}`,
  fixture_id: 'f1',
  version_number: n,
  kind: 'early',
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: computedAt,
  status: 'available',
  probabilities: { home: 0.46, draw: 0.34, away: 0.2 },
  expected_goals: null,
  most_likely_scorelines: null,
  leading_factors: null,
  data_completeness: 'available',
  inputs: null,
  unavailable_reason: null,
  unavailable_detail: null,
});
const forecasts: ForecastVersionsResponse = {
  fixture_id: 'f1',
  coverage: 'available',
  last_updated_at: '2026-10-08T12:00:00.000Z',
  latest: version(2, '2026-10-08T14:00:00.000Z'),
  versions: [version(1, '2026-10-08T12:00:00.000Z'), version(2, '2026-10-08T14:00:00.000Z')],
} as ForecastVersionsResponse;
const evaluation: ForecastEvaluation = {
  id: 'e1',
  forecast_id: 'v1',
  fixture_id: 'f1',
  version_number: 1,
  kind: 'early',
  model_version: 'dixon-coles-elo@0.6.0',
  computed_at: '2026-10-08T12:00:00.000Z',
  evaluated_at: '2026-10-08T16:00:00.000Z',
  pre_kickoff: true,
  actual: { home: 1, away: 1 },
  outcome: 'draw',
  p_outcome: 0.34,
  log_loss: 1.08,
  brier: 0.6,
  rps: 0.1258,
  correct: false,
  scoreline_hit: false,
};
const evaluations: FixtureEvaluationsResponse = {
  fixture_id: 'f1',
  coverage: 'available',
  last_updated_at: '2026-10-08T16:00:00.000Z',
  evaluations: [evaluation],
};
const KICKOFF = '2026-10-08T13:30:00.000Z';
const DRAW = { home: 1, away: 1 };

// After full time each product says what it called against the result in its
// own place, once (T-1744, D-365): the model in the Summary's card, the
// founder in the analysis, the community in its picks. The three-lane card
// that repeated them is gone.

describe('the model against the result', () => {
  const model = (
    f: ForecastVersionsResponse | null,
    e: FixtureEvaluationsResponse | null,
    locale = 'en',
  ) =>
    renderToStaticMarkup(
      <ForecastReality
        forecasts={f}
        evaluations={e}
        fixture={{
          status: 'finished',
          kickoff_at: KICKOFF,
          home: { id: 'h', name: 'Tractor' } as MatchCentre['fixture']['home'],
          away: { id: 'a', name: 'Esteghlal' } as MatchCentre['fixture']['away'],
        }}
        final={DRAW}
        matchXg={null}
        timeZone="UTC"
        locale={locale}
      />,
    );

  it('shows the scored pre-match version, what it gave the result and its RPS', () => {
    const html = model(forecasts, evaluations);
    expect(html).toContain('data-part="whole"');
    expect(html).toContain('Result: a draw. The model gave it 34.0%.');
    expect(html).toMatch(/data-testid="forecast-reality-rps"[^]*0\.126/);
    expect(html).toContain('Ranked probability score for this match 0.126 (0 is perfect).');
    expect(html).toContain('Pre-match forecast, frozen at kick-off.');
    // The card is about the version the evaluation scored.
    expect(html).toMatch(/data-version="1" data-current=""/);
    // The model's card alone: nothing of the founder's or the community's.
    expect(html).not.toMatch(/founder|community/);
  });

  it('without an evaluation shows the last version before kick-off, unscored', () => {
    const html = model(forecasts, null);
    expect(html).toContain('Result: a draw.');
    expect(html).toContain(EN['forecast.verdict.unscored']);
    expect(html).toContain('data-scored="false"');
    expect(html).not.toContain('data-testid="forecast-reality-rps"');
  });

  it('never shows another version’s score as this one’s (rule 3)', () => {
    // The evaluation scored a version the list does not hold: the card falls
    // back to the last version before kick-off, and that one is unscored.
    const other = {
      ...evaluations,
      evaluations: [{ ...evaluation, version_number: 9 }],
    } as FixtureEvaluationsResponse;
    const html = model(forecasts, other);
    expect(html).toContain('Result: a draw.');
    expect(html).not.toContain('data-testid="forecast-reality-rps"');
    expect(html).not.toContain('0.126');
  });

  it('says so when there was no version before kick-off, or the service did not answer', () => {
    const late = { ...forecasts, versions: [version(3, '2026-10-08T15:00:00.000Z')] };
    expect(model(late, null)).toContain(EN['forecastBar.noneBefore']);
    expect(model(late, null)).not.toContain('data-testid="forecast-reality-result"');
    expect(model(null, null)).toContain('data-state="unreachable"');
  });

  it('says it in Persian with Persian digits', () => {
    const html = model(forecasts, evaluations, 'fa');
    expect(html).toContain('۰٫۱۲۶');
    expect(html).toContain('نتیجه:');
    expect(html).not.toContain('data-translation="untranslated"');
  });
});

describe('the founder against the result', () => {
  const analysis = (
    outcome: 'home' | 'draw' | 'away',
    score: { home: number; away: number } | null,
  ): FounderAnalysisResponse => ({
    fixture_id: 'f1',
    analysis: {
      id: 'a1',
      fixture_id: 'f1',
      author: { id: 'u1', display_name: 'Mostafa' },
      versions: [
        {
          id: 'av1',
          version_number: 1,
          predicted_outcome: outcome,
          predicted_score: score,
          confidence: 3,
          reasoning: 'Tractor at home are hard to beat.',
          lineup_impact: null,
          key_players: null,
          form_and_context: null,
          published_at: '2026-10-07T10:00:00.000Z',
        },
      ],
    },
  });
  const founder = (
    a: FounderAnalysisResponse | null,
    result: { home: number; away: number } | null = DRAW,
  ) =>
    renderToStaticMarkup(
      <FounderAnalysisPanel
        analysis={a}
        result={result}
        home="Tractor"
        away="Esteghlal"
        timeZone="UTC"
        locale="en"
      />,
    );

  it('settles the published pick on the result, in the full analysis, signed', () => {
    const right = founder(analysis('draw', { home: 1, away: 1 }));
    expect(right).toContain('data-voice="founder"');
    expect(right).toContain('data-settled="right"');
    expect(right).toContain('The result matched the pick. The score was exact too.');
    expect(right).toContain('data-testid="founder-signature"');
    // The full card, not a row.
    expect(right).not.toContain('data-product-row');
    expect(right).toContain('Tractor at home are hard to beat.');
    const wrong = founder(analysis('home', { home: 2, away: 0 }));
    expect(wrong).toContain('data-settled="wrong"');
    expect(wrong).toContain('The result did not match the pick.');
    expect(wrong).not.toContain('exact');
  });

  it('says nothing about a result before there is one', () => {
    const html = founder(analysis('draw', null), null);
    expect(html).not.toContain('data-testid="founder-verdict-settled"');
    expect(html).not.toContain('data-settled');
  });

  it('with no analysis is one compact row in the founder’s voice, never a card', () => {
    for (const html of [founder(null), founder({ fixture_id: 'f1', analysis: null })]) {
      expect(html).toContain('data-product-row=""');
      expect(html).toContain('data-voice="founder"');
      expect(html).toContain('data-testid="founder-analysis"');
      expect(html).toContain('data-state="none"');
      expect(html).toContain(EN['analysis.founder.none']);
      // Its status is an icon and a word, not colour alone.
      expect(html).toMatch(/data-coverage-badge="not_supplied"[^]*<svg[^]*None yet/);
      // The founder's own name, set in the founder's face.
      expect(html).toMatch(
        /class="[^"]*font-serif[^"]*text-founder[^"]*"[^>]*>.*Founder’s analysis/,
      );
      // Never the model's colour, never a figure.
      expect(html).not.toMatch(/(text|bg|border)-model/);
      expect(html).not.toMatch(/\d%/);
      // One 48px line (T-1775, D-383): name and word on the summary, the
      // sentence behind it in a native details.
      expect(html).toContain('data-folded=""');
      const summary = /<summary[^>]*>([^]*)<\/summary>/.exec(html)?.[1] ?? '';
      expect(summary).toContain('None yet');
      expect(summary).not.toContain(EN['analysis.founder.none']);
    }
  });
});

describe('the community against the result', () => {
  const consensus: CommunityConsensusResponse = {
    coverage: 'available',
    last_updated_at: '2026-10-08T13:30:00.000Z',
    data: {
      fixture_id: 'f1',
      sample: 40,
      crowd: {
        counts: { home: 22, draw: 10, away: 8 },
        shares: { home: 0.55, draw: 0.25, away: 0.2 },
      },
      weighted: null,
      last_submitted_at: '2026-10-08T13:29:00.000Z',
      computed_at: '2026-10-08T13:30:00.000Z',
    },
  };
  const community = (result: { home: number; away: number } | null) =>
    renderToStaticMarkup(
      <CommunityForecastPanel
        consensus={consensus}
        result={result}
        home="Tractor"
        away="Esteghlal"
        timeZone="UTC"
        model={null}
        locale="en"
      />,
    );
  const row = (c: CommunityConsensusResponse | null) =>
    renderToStaticMarkup(<CommunityPicksRow consensus={c} locale="en" />);

  it('says the share that picked what happened, over its spread and sample', () => {
    const html = community(DRAW);
    expect(html).toMatch(/data-testid="community-verdict-share"[^>]*>25\.0% picked a draw/);
    expect(html).toContain('data-testid="consensus-crowd"');
    expect(html).not.toMatch(/bg-model|bg-founder/);
    expect(community({ home: 2, away: 0 })).toContain('55.0% picked');
  });

  it('says no share before there is a result', () => {
    expect(community(null)).not.toContain('data-testid="community-verdict-share"');
  });

  it('with no consensus is one compact row in the community’s voice', () => {
    const below = row({ coverage: 'not_supplied', last_updated_at: null, data: null });
    expect(below).toContain('data-product-row=""');
    expect(below).toContain('data-voice="community"');
    expect(below).toContain('data-testid="consensus"');
    expect(below).toContain('data-state="not_supplied"');
    expect(below).toContain('Fewer than 5 members have predicted this match');
    expect(below).toMatch(/data-coverage-badge="not_supplied"[^]*<svg[^]*Under 5/);
    const down = row(null);
    expect(down).toContain('data-state="unreachable"');
    expect(down).toContain(EN['matchCentre.community.unreachable']);
    expect(down).toContain('Not loaded');
    for (const html of [below, down]) {
      // Never the model's colour, never a figure of anybody's.
      expect(html).not.toMatch(/(text|bg|border)-(model|founder)/);
      expect(html).not.toMatch(/\d%/);
    }
  });

  it('draws no row when there is a consensus: the page draws the panel', () => {
    expect(row(consensus)).toBe('');
  });
});

describe('the match centre says what happened in words (T-1478)', () => {
  // As the page draws it: the moving modules from the server (D-409).
  const full = (c: MatchCentre, locale = 'en') => {
    const words = matchWords(locale);
    return renderToStaticMarkup(
      <MatchCentreView
        words={words}
        centre={c}
        timeZone="UTC"
        locale={locale}
        hero={{}}
        slots={liveSlots({ centre: c, locale, timeZone: 'UTC', words })}
      />,
    );
  };
  const sub = {
    id: 'i1',
    sequence: 1,
    minute: 64,
    added_time: null,
    kind: 'substitution' as const,
    side: 'home' as const,
    player: { id: 'p-off', name: 'Jorge Carrascal' },
    related_player: { id: 'p-on', name: 'Giorgian de Arrascaeta' },
    detail: null,
  };

  it('names the match in one heading', () => {
    const html = full(centre({}));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<h1 class="sr-only">Tractor v Esteghlal</h1>');
  });

  it('says who came on and who went off', () => {
    const html = full({
      ...centre({}),
      timeline: { coverage: 'available', last_updated_at: null, data: [sub] },
    });
    expect(html).not.toContain('↔');
    expect(html).toMatch(/Arrascaeta<\/a> on · <a[^>]*>[^<]*Carrascal<\/a> off/);
    const fa = full(
      { ...centre({}), timeline: { coverage: 'available', last_updated_at: null, data: [sub] } },
      'fa',
    );
    expect(fa).toContain('وارد شد');
    expect(fa).toContain('خارج شد');
  });

  it('leaves out a substitute who never came on (rule 3)', () => {
    const html = full({
      ...centre({}),
      player_statistics: {
        coverage: 'available',
        last_updated_at: null,
        data: [
          { id: 'p1', name: 'Played Starter', side: 'home', stats: { minutes: 90, rating: 7.2 } },
          { id: 'p2', name: 'Unused Bench', side: 'home', stats: { minutes: 0, rating: 0 } },
        ],
      },
    });
    expect(html).toContain('Starter');
    expect(html).not.toContain('Bench<');
  });
});

// ---------------------------------------------------------------------------
// A finished match's line-ups and player table, from the server (T-1801, T-1802)
// ---------------------------------------------------------------------------

describe('a finished match’s line-ups and player table (D-399, D-400)', () => {
  let seq = 0;
  const incident = (
    kind: MatchIncident['kind'],
    minute: number,
    who: MatchLineupPlayer | null,
    over: Partial<MatchIncident> = {},
  ): MatchIncident => {
    seq += 1;
    return {
      id: `i${seq}`,
      sequence: seq,
      minute,
      added_time: null,
      kind,
      side: 'home',
      player: who === null ? null : { id: who.id, name: who.name },
      related_player: null,
      detail: null,
      ...over,
    };
  };
  const finished = (
    home: MatchLineupPlayer[],
    events: MatchIncident[] | null,
    over: Partial<MatchCentre> = {},
  ): MatchCentre => ({
    ...centre({
      status: 'finished',
      home: team('h', 'Chelsea', '4-4-2'),
      away: team('a', 'Liverpool', '4-4-2'),
    }),
    lineups: {
      coverage: 'available',
      last_updated_at: '2026-10-08T16:00:00.000Z',
      data: { home, away: eleven(4, 4, 2) },
    },
    timeline:
      events === null
        ? empty
        : { coverage: 'available', last_updated_at: '2026-10-08T16:00:00.000Z', data: events },
    ...over,
  });
  const lineupsOf = (c: MatchCentre, locale = 'en') =>
    renderToStaticMarkup(<MatchLineups centre={c} locale={locale} words={matchWords(locale)} />);
  const pitch = (html: string) =>
    html.slice(
      html.indexOf('data-testid="pitch-home"'),
      html.indexOf('data-testid="lineup-pitch-note"'),
    );
  const bench = (html: string) => html.slice(html.indexOf('data-testid="lineup-benches"'));
  const text = (html: string) => html.replace(/<[^>]+>/g, '');

  it('says what happened to each player in words with the minute, and marks his disc', () => {
    const home = [...eleven(4, 4, 2), player('defender', { role: 'bench', name: 'Levi Colwill' })];
    home[9] = { ...home[9]!, name: 'Morgan Rogers' };
    home[1] = { ...home[1]!, name: 'Marc Lacroix' };
    const [rogers, lacroix, colwill] = [home[9]!, home[1]!, home[11]!];
    const html = lineupsOf(
      finished(home, [
        incident('penalty_goal', 40, rogers),
        incident('yellow_card', 45, lacroix, { added_time: 1 }),
        incident('substitution', 45, lacroix, {
          added_time: 1,
          related_player: { id: colwill.id, name: colwill.name },
        }),
        // A shoot-out kick is never a goal of the match (D-322).
        incident('penalty_goal', 120, home[2]!, { in_shootout: true }),
      ]),
    );
    const onPitch = pitch(html);
    expect(text(onPitch)).toContain('Goal 40′ (pen.)');
    expect(text(onPitch)).toContain('Booked 45+1′ · Off 45+1′');
    expect(text(onPitch)).not.toContain('120′');
    expect(onPitch.match(/data-testid="lineup-marks"/g)).toHaveLength(2);
    // The glyph on the disc is decoration beside the words.
    expect(onPitch).toMatch(
      /aria-hidden="true" class="absolute -start-1 -top-0\.5[^"]*" data-testid="lineup-disc-marks"/,
    );
    expect(onPitch).toContain('bg-warning');
    expect(onPitch).toContain('>↓</span>');
    // The bench says who came on, when and for whom.
    expect(text(bench(html))).toContain('On 45+1′ for M. Lacroix');
    expect(bench(html)).toContain('>↑</span>');
  });

  it('finds the kicks the feed did not flag as the key events do: never a goal (D-322)', () => {
    const home = eleven(4, 4, 2);
    const c = finished(home, [
      incident('penalty_goal', 40, home[9]!),
      // A shoot-out with no `in_shootout` (another adapter, or no label from
      // the feed): read back from its 2-0 score, as `shootoutStart` does.
      incident('penalty_goal', 120, home[2]!),
      incident('penalty_missed', 120, null, { side: 'away' }),
      incident('penalty_goal', 120, home[3]!),
    ]);
    const html = lineupsOf({
      ...c,
      fixture: {
        ...c.fixture,
        scores: {
          ...c.fixture.scores,
          current: { home: 1, away: 0 },
          penalties: { home: 2, away: 0 },
        },
      },
    });
    expect(text(pitch(html))).toContain('Goal 40′ (pen.)');
    expect(text(pitch(html))).not.toContain('120′');
    expect(pitch(html).match(/data-testid="lineup-marks"/g)).toHaveLength(1);
  });

  it('never writes "for" with nobody after it when the feed left out who went off', () => {
    const home = [...eleven(4, 4, 2), player('forward', { role: 'bench', name: 'Emanuel Emegha' })];
    const sub = home[11]!;
    const html = lineupsOf(
      finished(home, [
        incident('substitution', 68, null, { related_player: { id: sub.id, name: sub.name } }),
      ]),
    );
    expect(text(bench(html))).toContain('On 68′');
    expect(text(bench(html))).not.toMatch(/On 68′ for/);
  });

  it('in play, the marks so far, "On 68′ for …" on the bench, and no verdict on missing events (T-1814)', () => {
    const home = [...eleven(4, 4, 2), player('forward', { role: 'bench', name: 'Emanuel Emegha' })];
    const [off, on] = [home[10]!, home[11]!];
    const live = (events: MatchIncident[] | null): MatchCentre => {
      const c = finished(home, events);
      return { ...c, fixture: { ...c.fixture, status: 'live', minute: 70 } };
    };
    const html = lineupsOf(
      live([incident('substitution', 68, off, { related_player: { id: on.id, name: on.name } })]),
    );
    expect(text(bench(html))).toMatch(/On 68′ for /);
    // The events not in yet: the key events card says so, not the pitch.
    expect(lineupsOf(live(null))).not.toContain('data-testid="lineup-marks-none"');
    // Before the line-ups arrive in play, "Not in yet", never "not supplied".
    const waiting = lineupsOf({ ...live(null), lineups: empty });
    expect(waiting).toContain(EN['matchCentre.notInYet']);
    expect(waiting).not.toContain('Not supplied for this match.');
  });

  it('writes the surname whole, with the initial only where two players share it', () => {
    const home = eleven(4, 4, 2);
    home[0] = { ...home[0]!, name: 'Jorrel Acheampong' };
    home[5] = { ...home[5]!, name: 'Reece James' };
    home[6] = { ...home[6]!, name: 'Daniel James' };
    const onPitch = pitch(lineupsOf(finished(home, [])));
    expect(onPitch).toMatch(/>Acheampong<\/span>/);
    expect(onPitch).not.toContain('J. Acheampong');
    expect(onPitch).toContain('>R. James</span>');
    expect(onPitch).toContain('>D. James</span>');
    expect(onPitch).toContain('title="Jorrel Acheampong"');
  });

  it('says the pitch carries no marks when the events are not supplied, and nothing when none happened', () => {
    const none = lineupsOf(finished(eleven(4, 4, 2), null));
    expect(none).toContain('data-testid="lineup-marks-none"');
    expect(none).toContain('The match events are not supplied');
    expect(lineupsOf(finished(eleven(4, 4, 2), []))).not.toContain('lineup-marks');
  });

  it('writes the marks in the reader’s language and digits', () => {
    const home = eleven(4, 4, 2);
    const html = lineupsOf(finished(home, [incident('goal', 67, home[9]!)]), 'fa');
    expect(html).toContain('گل ۶۷′');
  });

  it('keeps the player table’s names in view, quiets its zeros, rates in the neutral chip', () => {
    const c = finished(eleven(4, 4, 2), [], {
      player_statistics: {
        coverage: 'available',
        last_updated_at: null,
        data: [
          {
            id: 'x1',
            name: 'Cody Gakpo',
            side: 'home',
            stats: { minutes: 90, rating: 7.2, goals: 1, assists: 0 },
          },
        ],
      },
    });
    const html = renderToStaticMarkup(
      <MatchStats centre={c} locale="en" words={matchWords('en')} />,
    );
    const table = html.slice(html.indexOf('data-testid="player-statistics"'));
    expect(table).toMatch(/<th scope="row" class="sticky start-0[^"]*bg-surface/);
    expect(table).toMatch(/text-caption">0</);
    expect(table).toMatch(/data-rating-band="high"[^>]*>7\.2</);
    expect(table).toContain('– no figure supplied for this player');
  });
});
