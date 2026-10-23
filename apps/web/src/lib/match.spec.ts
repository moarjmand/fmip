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
});
