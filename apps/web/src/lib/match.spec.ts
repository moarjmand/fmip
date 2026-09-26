import { describe, expect, it } from 'vitest';
import {
  NOT_YET,
  PLAYER_COLUMNS,
  minuteLabel,
  moduleState,
  playerCell,
  statValue,
  xgNotice,
} from './match';

describe('match centre labels', () => {
  it('writes minutes with added time', () => {
    expect(minuteLabel(67, null)).toBe('67′');
    expect(minuteLabel(45, 2)).toBe('45+2′');
    expect(minuteLabel(90, 0)).toBe('90′');
  });

  it('formats statistics by metric and never invents a missing side', () => {
    expect(statValue('possession_pct', 58.5)).toBe('58.5%');
    expect(statValue('expected_goals', 2.1)).toBe('2.10');
    expect(statValue('shots', 14)).toBe('14');
    expect(statValue('shots', null)).toBe('–');
  });

  it('names the coverage state of a module', () => {
    expect(moduleState({ coverage: 'limited', last_updated_at: null, data: [1] })).toBe('limited');
    expect(moduleState({ coverage: 'not_supplied', last_updated_at: null, data: null })).toBe(
      'not supplied',
    );
    expect(moduleState({ coverage: 'delayed', last_updated_at: null, data: null })).toBe(
      'data delayed',
    );
  });

  it('lists every blueprint 4.2 module the page does not have yet', () => {
    // Equality, not containment: a module that reaches the page must leave
    // this list, or the page says "not yet" about something it shows.
    expect(NOT_YET.map(([name]) => name)).toEqual(['Availability', 'Key players']);
  });
});

describe('expected goals', () => {
  it('says so when a match has statistics but no xG, and says nothing when it has', () => {
    expect(xgNotice(['possession_pct', 'shots'])).toContain('did not supply');
    expect(xgNotice(['possession_pct', 'expected_goals'])).toBeNull();
  });
});

describe('player statistics', () => {
  const haaland = {
    id: 'p',
    name: 'Erling Haaland',
    side: 'away' as const,
    stats: { minutes: 80, rating: 8.6, goals: 2 },
  };

  it('shows the rating to one decimal, a count as it is, and a dash for what was not supplied', () => {
    expect(playerCell(haaland, 'rating')).toBe('8.6');
    expect(playerCell(haaland, 'goals')).toBe('2');
    expect(playerCell(haaland, 'assists')).toBe('–');
  });

  it('starts with minutes and never lists a per-player xG it cannot fill', () => {
    expect(PLAYER_COLUMNS[0]?.[0]).toBe('minutes');
    expect(PLAYER_COLUMNS.map(([metric]) => metric)).not.toContain('expected_goals');
  });
});
