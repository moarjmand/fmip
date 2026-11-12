import type { MatchCentre, MatchIncident } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { matchWords } from '@/lib/words-server';
import { MatchCentreView } from './match-centre-view';
import { KeyEvents, shootoutHero } from './match-key-events';
import { ScoreBar, bandState } from './match-score-bar';

/**
 * A finished match's key events and its shoot-out, drawn on the server and
 * handed to the match centre as the `keyEvents` slot and the band's
 * `penalties` (T-1798, T-1799; D-396, D-397; board P9-3). `page` renders
 * them the way `match/[id]/page.tsx` does; the live path keeps the client's
 * own timeline.
 */

const KICKOFF = '2026-10-28T20:00:00.000Z';
const empty = { coverage: 'not_supplied' as const, last_updated_at: null, data: null };
const team = (id: string, name: string) => ({
  id,
  name,
  short_name: null,
  code: null,
  formation: null,
  coach: null,
});
const incident = (
  minute: number,
  kind: MatchIncident['kind'],
  side: 'home' | 'away',
  name: string,
): MatchIncident => ({
  id: `${kind}-${minute}-${name}`,
  sequence: minute,
  minute,
  added_time: null,
  kind,
  side,
  player: { id: `p-${name}`, name },
  related_player: null,
  detail: null,
});
const scores = {
  current: { home: 1, away: 1 },
  half_time: { home: 1, away: 1 },
  full_time: { home: 1, away: 1 },
  extra_time: null as { home: number; away: number } | null,
  penalties: { home: 6, away: 5 } as { home: number; away: number } | null,
  aggregate: null,
};
const centre = (over: Partial<MatchCentre['fixture']>, data: MatchIncident[]) =>
  ({
    fixture: {
      id: 'f1',
      kickoff_at: KICKOFF,
      status: 'finished',
      minute: null,
      competition: { id: 'c', name: 'EFL Cup', short_name: null, country_id: null },
      season: { id: 's', label: '2026/27' },
      stage: null,
      round: null,
      group_name: null,
      leg: null,
      home: team('h', 'Liverpool'),
      away: team('a', 'Chelsea'),
      scores,
      venue: null,
      is_neutral_venue: false,
      referee: null,
      attendance: null,
      periods: [],
      last_updated_at: '2026-10-28T22:14:00.000Z',
      freshness: null,
      ...over,
    },
    timeline: { coverage: 'available', last_updated_at: null, data },
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
  }) as MatchCentre;

/** The match centre as the page draws it: the server's slot and band line. */
const page = (c: MatchCentre, locale = 'en') => {
  const words = matchWords(locale);
  return renderToStaticMarkup(
    <MatchCentreView
      words={words}
      centre={c}
      timeZone="Europe/London"
      locale={locale}
      hero={{ penalties: shootoutHero(locale, c.fixture) }}
      slots={{
        keyEvents:
          c.fixture.status === 'finished' ? (
            <KeyEvents centre={c} locale={locale} timeZone="Europe/London" words={words} />
          ) : undefined,
      }}
    />,
  );
};
/** The whole Key events card, the shoot-out's inner section included. */
const keyEvents = (html: string) => {
  const start = html.indexOf('data-testid="timeline"');
  const inner = html.indexOf('data-testid="shootout"', start);
  const from = inner > 0 ? html.indexOf('</section>', inner) + 1 : start;
  return html.slice(start, html.indexOf('</section>', from));
};
const words = (html: string) => html.replace(/<[^>]+>/g, '');

// Liverpool 1-1 Chelsea, League Cup, 28 Oct 2026: Liverpool won 6-5 on
// penalties (the site's own record, board P9-3).
const kick = (n: number, side: 'home' | 'away', name: string, scored: boolean): MatchIncident => ({
  ...incident(120, scored ? 'penalty_goal' : 'penalty_missed', side, name),
  id: `k${n}`,
  sequence: 200 + n,
  in_shootout: true,
});
const home = ['A. Mac Allister', 'A. Isak', 'C. Gakpo', 'F. Wirtz', 'K. Tsimikas', 'B. Barcola'];
const away = ['Pedro Neto', 'M. Rogers', 'R. Lavia', 'V. Barco', 'J. Henderson', 'L. Colwill'];
const homeScored = [true, true, true, true, false, true, false, true];
const awayScored = [true, true, true, false, true, true, false, false];
home.push('R. Gravenberch', 'J. Gomez');
away.push('E. Emegha', 'W. Fofana');
const kicks = home.flatMap((name, r) => [
  kick(2 * r + 1, 'home', name, homeScored[r]!),
  kick(2 * r + 2, 'away', away[r]!, awayScored[r]!),
]);
const sub = (
  minute: number,
  side: 'home' | 'away',
  on: string,
  off: string,
  added: number | null = null,
) => ({
  ...incident(minute, 'substitution', side, off),
  id: `sub-${side}-${on}`,
  added_time: added,
  related_player: { id: `p-${on}`, name: on },
});
const play: MatchIncident[] = [
  incident(11, 'yellow_card', 'home', 'L. Koumas'),
  incident(40, 'penalty_goal', 'away', 'M. Rogers'),
  incident(43, 'penalty_goal', 'home', 'C. Gakpo'),
  sub(45, 'away', 'L. Colwill', 'M. Lacroix', 1),
  sub(59, 'home', 'B. Barcola', 'L. Koumas'),
  sub(59, 'home', 'F. Wirtz', 'J. McConnell'),
];
const cup = (penalties = scores.penalties, data = [...play, ...kicks]) =>
  centre({ scores: { ...scores, penalties } }, data);

describe('who went through on penalties (T-1798, D-396)', () => {
  it('says who won the shoot-out under the result, from its score', () => {
    const html = page(cup());
    expect(html).toMatch(/data-testid="shootout-winner">/);
    expect(words(html)).toContain('Liverpool win 6–5 on penalties');
    // The away side, its score read winner first.
    expect(words(page(cup({ home: 1, away: 4 })))).toContain('Chelsea win 4–1 on penalties');
    // In Persian, the team isolated, its own digits.
    const fa = page(cup(), 'fa');
    expect(fa).toContain('<bdi>Liverpool</bdi> در ضربات پنالتی');
    expect(words(fa)).toContain('۶–۵ پیروز شد');
  });

  it('never guesses a winner the shoot-out’s score does not name (rule 3)', () => {
    const level = words(page(cup({ home: 3, away: 3 })));
    expect(level).toContain('The shoot-out’s winner is not in the record');
    expect(level).not.toMatch(/win \d/);
    expect(shootoutHero('en', cup({ home: 3, away: 3 }).fixture)).not.toHaveProperty('home');
    // No shoot-out, or one still being played: nothing.
    expect(shootoutHero('en', cup(null).fixture)).toBeUndefined();
    expect(
      shootoutHero('en', centre({ status: 'live', minute: 120 }, play).fixture),
    ).toBeUndefined();
    expect(page(cup(null, play))).not.toContain('shootout-winner');
  });

  it('marks the winner in the compact score bar, its words on hover', () => {
    const bar = (c: MatchCentre, locale = 'en') => {
      const w = matchWords(locale);
      const state = bandState(
        c.fixture,
        {},
        { locale, timeZone: 'Europe/London', now: undefined, words: w },
      );
      return renderToStaticMarkup(
        <ScoreBar
          fixture={c.fixture}
          state={state}
          locale={locale}
          words={w}
          marks={shootoutHero(locale, c.fixture)}
        />,
      );
    };
    const text = (html: string) => words(html.replace(/></g, '> <')).replace(/\s+/g, ' ').trim();
    expect(text(bar(cup()))).toBe('✓ Liverpool 1–1 Chelsea Pens 6–5');
    expect(bar(cup())).toContain('title="Won on penalties"');
    expect(text(bar(cup({ home: 1, away: 4 })))).toBe('Liverpool 1–1 ✓ Chelsea Pens 1–4');
    expect(bar(cup({ home: 3, away: 3 }))).not.toContain('✓');
    expect(bar(cup(), 'fa')).toContain('title="برنده در ضربات پنالتی"');
  });
});

describe('a finished match’s key events, from the server (T-1798, T-1799; D-396, D-397)', () => {
  it('is the slot: one Key events card, the client’s timeline not drawn', () => {
    const html = page(cup());
    expect(html.match(/data-testid="timeline"/g)).toHaveLength(1);
    expect(keyEvents(html)).toContain('Key events');
    // No numbered kick rows: the client's shoot-out list is not drawn.
    expect(html).not.toContain('Kick 1');
  });

  it('calls a penalty scored in play "Goal (penalty)", never the bare word of a kick', () => {
    const list = keyEvents(page(cup()));
    expect(words(list)).toContain('Goal (penalty) · Chelsea');
    expect(words(list)).toContain('Goal (penalty) · Liverpool');
    expect(words(list)).not.toMatch(/Penalty ·/);
    expect(words(keyEvents(page(cup(), 'fa')))).toContain('گل (پنالتی)');
  });

  it('draws the shoot-out as two rows of circles, scored and missed said in words', () => {
    const timeline = keyEvents(page(cup()));
    const card = timeline.slice(timeline.indexOf('data-testid="shootout"'));
    expect(timeline.match(/data-kick="/g)).toHaveLength(16);
    const row = (side: string) => {
      const at = card.indexOf(`>${side}</bdi>`);
      return card.slice(at, card.indexOf('</ol>', at));
    };
    expect(row('Liverpool').match(/data-kick="scored"/g)).toHaveLength(6);
    expect(row('Liverpool').match(/data-kick="missed"/g)).toHaveLength(2);
    expect(row('Chelsea').match(/data-kick="scored"/g)).toHaveLength(5);
    expect(row('Chelsea').match(/data-kick="missed"/g)).toHaveLength(3);
    // The order recorded, each kick's word for a screen reader, the taker's surname.
    expect(words(row('Liverpool'))).toMatch(/^>Liverpool6✓ScoredMac Allister✓ScoredIsak✓/);
    expect(words(row('Liverpool'))).toContain('✕MissedTsimikas');
    expect(card).toMatch(/<span aria-hidden="true" class="[^"]*border-dashed/);
    expect(words(card)).toContain('Penalty shoot-out6–5');
    expect(words(card)).toContain('Dashed circle with a cross: missed.');
    // After the events of play.
    expect(timeline.indexOf('data-testid="shootout"')).toBeGreaterThan(timeline.indexOf('</ol>'));
    const fa = words(keyEvents(page(cup(), 'fa')));
    expect(fa).toContain('گل شد');
    expect(fa).toContain('از دست رفت');
  });

  it('folds the substitutions into a native details, counted, out of the list', () => {
    const timeline = keyEvents(page(cup()));
    const list = timeline.slice(timeline.indexOf('<ol'), timeline.indexOf('</ol>'));
    expect(list).toContain('Kick-off');
    expect(list).not.toContain('Substitution ·');
    const fold = timeline.slice(timeline.indexOf('<details'), timeline.indexOf('</details>'));
    expect(fold).toMatch(/<summary class="[^"]*min-h-touch[^"]*">/);
    expect(words(fold)).toContain('Substitutions (3)');
    expect(words(fold)).toContain('L. Colwill on');
    expect(words(fold)).toContain('45+1′');
    expect(keyEvents(page(cup(scores.penalties, play.slice(0, 3))))).not.toContain('<details');
    expect(words(keyEvents(page(cup(), 'fa')))).toContain('تعویض‌ها (۳)');
  });

  it('draws goals and cards on two named lanes, home above away, on a 0-45-90 scale', () => {
    const html = keyEvents(page(cup()));
    const axis = html.slice(html.indexOf('role="img"'), html.indexOf('<ol'));
    expect(axis).toContain('role="img"');
    expect(axis).toContain('goals: 2, cards: 1');
    expect(axis.indexOf('data-lane="home"')).toBeLessThan(axis.indexOf('data-lane="away"'));
    expect(axis).toMatch(/data-lane="home"><span[^>]*><bdi>Liverpool</);
    expect(axis).toMatch(/data-lane="away"><span[^>]*><bdi>Chelsea</);
    const lane = (side: string) =>
      axis.slice(
        axis.indexOf(`data-lane="${side}"`),
        axis.indexOf('</div>', axis.indexOf(`data-lane="${side}"`)),
      );
    expect(lane('home')).toMatch(/data-kind="yellow_card"[^]*bg-warning[^]*>11′</);
    expect(lane('away')).toMatch(/data-kind="penalty_goal"[^]*rounded-full bg-fg[^]*>40′</);
    expect(axis).not.toMatch(/data-kind="substitution"/);
    // The kicks are not on the axis.
    expect(axis.match(/data-kind="/g)).toHaveLength(3);
    expect(axis).toMatch(
      /inset-inline-start:0%">0<[^]*inset-inline-start:50%">45<[^]*inset-inline-start:100%">90</,
    );
    expect(axis).toContain('Yellow card</span>');
  });

  it('extends the scale for extra time and keeps close minutes from overlapping', () => {
    const c = centre(
      {
        scores: {
          ...scores,
          current: { home: 0, away: 1 },
          full_time: { home: 0, away: 0 },
          extra_time: { home: 0, away: 1 },
          penalties: null,
        },
      },
      [
        incident(59, 'yellow_card', 'home', 'B. Barcola'),
        incident(62, 'yellow_card', 'home', 'R. Araújo'),
        incident(113, 'goal', 'away', 'E. Nketiah'),
      ],
    );
    const html = keyEvents(page(c));
    const axis = html.slice(0, html.indexOf('<ol'));
    expect(axis).toMatch(/">105<[^]*inset-inline-start:100%">120</);
    expect(axis).toMatch(/class="invisible">62′</);
    expect(axis).not.toMatch(/class="invisible">59′</);
    expect(html.slice(html.indexOf('<ol'))).toContain('62′');
  });

  it('says nothing recorded in words, never an empty card (rule 3)', () => {
    expect(keyEvents(page(cup(null, [])))).toContain('data-testid="no-events"');
  });

  it('while the match is on, the client’s own timeline stays, and no winner is said', () => {
    const live = centre(
      { status: 'live', minute: 120, scores: { ...scores, penalties: { home: 1, away: 1 } } },
      [...play, ...kicks.slice(0, 2)],
    );
    const html = page(live);
    expect(html).toContain('Kick 1');
    expect(html).not.toContain('data-lane=');
    expect(html).not.toContain('shootout-winner');
  });
});
