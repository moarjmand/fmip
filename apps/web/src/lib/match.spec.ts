import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/messages';
import { INCIDENT_KEY, NOT_YET, STAT_KEY, minuteLabel, shootoutStart, statValue } from './match';

describe('match centre labels', () => {
  it('writes minutes with added time', () => {
    expect(minuteLabel(67, null)).toBe('67′');
    expect(minuteLabel(45, 2)).toBe('45+2′');
    expect(minuteLabel(90, 0)).toBe('90′');
  });

  it('writes minutes in Persian digits for fa', () => {
    expect(minuteLabel(45, 2, 'fa')).toBe('۴۵+۲′');
  });

  it('formats statistics by metric and never invents a missing side', () => {
    expect(statValue('possession_pct', 58.5)).toBe('58.5%');
    expect(statValue('expected_goals', 2.1)).toBe('2.10');
    expect(statValue('shots', 14)).toBe('14');
    expect(statValue('shots', null)).toBe('–');
    expect(statValue('shots', 14, 'fa')).toBe('۱۴');
  });

  it('names incidents and statistics from the catalogue, in the reader’s language', () => {
    expect(t('en', INCIDENT_KEY.goal)).toBe('Goal');
    expect(t('en', STAT_KEY.possession_pct)).toBe('Possession');
    expect(t('fa', STAT_KEY.possession_pct)).toBe('مالکیت توپ');
  });

  it('lists every blueprint 4.2 module the page does not have yet', () => {
    // Equality, not containment: a module that reaches the page must leave
    // this list, or the page says "not yet" about something it shows.
    expect(NOT_YET.map(([name]) => name)).toEqual([]);
  });
});

describe('shootoutStart (T-1477)', () => {
  type Side = 'home' | 'away';
  const k = (kind: string, side: Side) => ({ kind, side });
  // Flamengo 0-0 Estudiantes, 2026-10-23: two legs, 2-3 on penalties.
  const play = [k('yellow_card', 'away'), k('red_card', 'away'), k('substitution', 'home')];
  const kicks = [
    k('penalty_goal', 'home'),
    k('penalty_goal', 'away'),
    k('penalty_missed', 'home'),
    k('penalty_missed', 'away'),
    k('penalty_missed', 'home'),
    k('penalty_goal', 'away'),
    k('penalty_goal', 'home'),
    k('penalty_goal', 'away'),
    k('penalty_missed', 'home'),
  ];

  it('finds the kicks that add up to the shoot-out score', () => {
    expect(shootoutStart([...play, ...kicks], { home: 2, away: 3 })).toBe(play.length);
  });

  it('leaves a penalty scored in play out of the shoot-out', () => {
    const inPlay = [...play, k('penalty_goal', 'home')];
    expect(shootoutStart([...inPlay, ...kicks], { home: 2, away: 3 })).toBe(inPlay.length);
  });

  it('says nothing without a shoot-out score, or when the kicks do not add up', () => {
    expect(shootoutStart([...play, ...kicks], null)).toBeNull();
    expect(shootoutStart([...play, ...kicks], { home: 4, away: 3 })).toBeNull();
    expect(shootoutStart(play, { home: 2, away: 3 })).toBeNull();
    expect(shootoutStart([], { home: 0, away: 0 })).toBeNull();
  });

  // Manresa 2-2 Sant Andreu after extra time, 2026-10-27, 1-4 on penalties: the
  // feed left Manresa's scored kick out, so no run adds up (T-1666).
  const m = (kind: string, side: Side, minute: number) => ({ kind, side, minute });
  const manresa = [
    m('goal', 'home', 93),
    m('goal', 'away', 105),
    m('yellow_card', 'away', 114),
    m('penalty_goal', 'home', 116),
    m('goal', 'away', 119),
    m('yellow_card', 'away', 120),
    m('penalty_missed', 'home', 120),
    m('penalty_goal', 'away', 120),
    m('penalty_missed', 'home', 120),
    m('penalty_goal', 'away', 120),
    m('penalty_goal', 'away', 120),
    m('penalty_goal', 'away', 120),
  ];
  const pens = { home: 1, away: 4 };

  it('reads a shoot-out with a kick missing from the score after play', () => {
    expect(shootoutStart(manresa, pens)).toBeNull();
    expect(shootoutStart(manresa, pens, { home: 2, away: 2 })).toBe(6);
  });

  it('keeps a penalty scored in play at the kicks minute out of the shoot-out', () => {
    // Sant Andreu's third goal a penalty at 120+1 in play: the run of penalties
    // at 120 starts with it, and its kicks still do not add up.
    const late = [...manresa.slice(0, 5), m('penalty_goal', 'away', 120), ...manresa.slice(6)];
    expect(shootoutStart(late, pens)).toBeNull();
    expect(shootoutStart(late, pens, { home: 2, away: 3 })).toBe(6);
  });

  it('takes the marked kicks first, and reads an unmarked list as before (T-1673)', () => {
    const marked = (list: typeof manresa, from: number) =>
      list.map((i, n) => ({ ...i, in_shootout: n >= from }));
    // Manresa's kicks as the API marks them: no score needed, none read.
    expect(shootoutStart(marked(manresa, 6), null)).toBe(6);
    expect(shootoutStart(marked(manresa, 6), pens)).toBe(6);
    // A mark wins over a reading: with a scored kick missing, an in-play
    // penalty at 120+1 makes the run add up to 0-5 and is read as a kick; the
    // marks keep it in play.
    const late = [...manresa.slice(0, 5), m('penalty_goal', 'away', 120), ...manresa.slice(6)];
    expect(shootoutStart(late, { home: 0, away: 5 })).toBe(5);
    expect(shootoutStart(marked(late, 6), { home: 0, away: 5 })).toBe(6);
    // Every flag false: the reading, as for an older API.
    expect(shootoutStart(marked(manresa, 99), pens, { home: 2, away: 2 })).toBe(6);
    // Something unmarked after the marked kicks: no block rather than a guess.
    const after = [...marked(manresa, 6), { ...m('yellow_card', 'home', 120), in_shootout: false }];
    expect(shootoutStart(after, pens)).toBeNull();
  });

  // The provider numbers the kicks 120+1, 120+2, ... (D-322's third reading).
  const n = (seq: number, kind: string, side: Side, minute: number, added: number | null) => ({
    sequence: seq,
    kind,
    side,
    minute,
    added_time: added,
  });

  it("reads the kicks by the provider's numbering when the scores do not add up (D-322)", () => {
    // 1-1 with neither goal recorded, 5-4 on penalties, the fifth kick (a
    // goal) never stored: its place 7 is empty and its number 5 missing.
    const long = [
      n(1, 'substitution', 'home', 60, null),
      n(3, 'penalty_goal', 'home', 120, 1),
      n(4, 'penalty_goal', 'away', 120, 2),
      n(5, 'penalty_goal', 'home', 120, 3),
      n(6, 'penalty_goal', 'away', 120, 4),
      n(8, 'penalty_goal', 'away', 120, 6),
      n(9, 'penalty_goal', 'home', 120, 7),
      n(10, 'penalty_goal', 'away', 120, 8),
      n(11, 'penalty_goal', 'home', 120, 9),
      n(12, 'penalty_missed', 'away', 120, 10),
    ];
    const fivefour = { home: 5, away: 4 };
    expect(shootoutStart(long, fivefour, { home: 1, away: 1 })).toBe(1);
    // A number skipped where no place is empty: the numbering is broken.
    const broken = long.map((i) => (i.sequence >= 8 ? { ...i, sequence: i.sequence - 1 } : i));
    expect(shootoutStart(broken, fivefour, { home: 1, away: 1 })).toBeNull();
    // Without places (a score card), only a numbering with no gap is read.
    const card = long.map(({ sequence: _, ...i }) => i);
    expect(shootoutStart(card, fivefour, { home: 1, away: 1 })).toBeNull();
    expect(shootoutStart(card.slice(0, 5), fivefour, { home: 1, away: 1 })).toBe(1);
    // More scored kicks than the shoot-out's score: not a shoot-out read.
    expect(shootoutStart(long, { home: 3, away: 2 }, { home: 1, away: 1 })).toBeNull();
  });

  it('starts the numbering at its last 1, an in-play penalty at 120+1 kept in play', () => {
    const late = [
      n(1, 'goal', 'away', 50, null),
      n(2, 'yellow_card', 'home', 110, null),
      n(4, 'penalty_goal', 'home', 120, 1),
      n(5, 'penalty_goal', 'home', 120, 1),
      n(6, 'penalty_goal', 'away', 120, 2),
      n(7, 'penalty_goal', 'home', 120, 3),
      n(8, 'penalty_missed', 'away', 120, 4),
      n(10, 'penalty_goal', 'away', 120, 6),
      n(11, 'penalty_goal', 'home', 120, 7),
    ];
    expect(shootoutStart(late, { home: 4, away: 3 }, { home: 2, away: 2 })).toBe(3);
    // A lone kick numbered 1, or kicks at another minute, are not read.
    expect(shootoutStart(late.slice(0, 4), { home: 4, away: 3 })).toBeNull();
    const moved = late.map((i, at) => (at === 8 ? { ...i, minute: 121 } : i));
    expect(shootoutStart(moved, { home: 4, away: 3 })).toBeNull();
  });

  it('leaves the list as recorded when the goals of play do not add up', () => {
    expect(shootoutStart(manresa, pens, { home: 3, away: 3 })).toBeNull();
    expect(shootoutStart(manresa, pens, { home: 1, away: 1 })).toBeNull();
    expect(shootoutStart(manresa, { home: 1, away: 2 }, { home: 2, away: 2 })).toBeNull();
  });
});
