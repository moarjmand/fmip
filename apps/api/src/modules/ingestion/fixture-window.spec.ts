import { describe, expect, it } from 'vitest';
import { SCHEDULE_SWEEP_HOUR, fixtureWindow } from './ingestion-jobs.service';

/** T-505: a week around now every hour, and the rest of the season once a day. */
describe('the fixtures window', () => {
  const at = (hour: number) => new Date(Date.UTC(2026, 8, 26, hour, 7));

  it('asks for a window around now in an ordinary hour', () => {
    expect(fixtureWindow(at(SCHEDULE_SWEEP_HOUR + 1), '2027-05-30')).toEqual({
      from: '2026-09-24',
      to: '2026-10-03',
      sweep: false,
    });
  });

  it('asks for the rest of the season once a day', () => {
    expect(fixtureWindow(at(SCHEDULE_SWEEP_HOUR), '2027-05-30')).toEqual({
      from: '2026-09-24',
      to: '2027-05-30',
      sweep: true,
    });
  });

  it('never asks for less than the window, even when the recorded season ends sooner', () => {
    expect(fixtureWindow(at(SCHEDULE_SWEEP_HOUR), '2026-09-30').to).toBe('2026-10-03');
  });
});
