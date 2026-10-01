import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/messages';
import { INCIDENT_KEY, NOT_YET, STAT_KEY, minuteLabel, statValue } from './match';

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
