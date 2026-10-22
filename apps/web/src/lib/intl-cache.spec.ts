import { describe, expect, it } from 'vitest';
import { dateTimeFormat, numberFormat, relativeTimeFormat } from './intl-cache';

/**
 * One formatter per locale and option set (T-1466): asked twice the same, the
 * same object; asked differently, a different one that formats as `Intl`
 * itself would.
 */
describe('Intl formatters, made once', () => {
  it('hands back the same formatter for the same locale and options', () => {
    const options = { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' } as const;
    expect(dateTimeFormat('en-GB', options)).toBe(dateTimeFormat('en-GB', { ...options }));
    expect(numberFormat('fa')).toBe(numberFormat('fa'));
    expect(relativeTimeFormat('es', { numeric: 'auto' })).toBe(
      relativeTimeFormat('es', { numeric: 'auto' }),
    );
  });

  it('keeps a different locale, zone or option set apart, formatting as Intl does', () => {
    const at = new Date('2026-10-22T16:28:00Z');
    const london = dateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const tehran = dateTimeFormat('en-GB', {
      timeZone: 'Asia/Tehran',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    expect(london).not.toBe(tehran);
    expect(london.format(at)).toBe('17:28');
    expect(tehran.format(at)).toBe('19:58');
    expect(numberFormat('fa').format(2026)).toBe(new Intl.NumberFormat('fa').format(2026));
    expect(numberFormat('fa', { useGrouping: false })).not.toBe(numberFormat('fa'));
  });
});
