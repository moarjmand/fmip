import { describe, expect, it } from 'vitest';
import type { NotificationsService } from '../notifications/notifications.service';
import type { MatchAlertsStore } from './internal/match-alerts-store';
import { MatchAlertsService } from './match-alerts.service';

/**
 * Carrying a run's alerts (T-834): a pass reads a page of 100, so a run that
 * told more members than that passes again until they have nothing due --
 * and stops when a pass finds less than a page, or can claim nothing.
 */
function service(passes: { due: number; carried: number }[]) {
  const calls: { userIds: string[] }[] = [];
  const notifications = {
    carry: (scope: { userIds: string[] }) => {
      calls.push(scope);
      return Promise.resolve(passes[calls.length - 1] ?? { due: 0, carried: 0 });
    },
  } as unknown as NotificationsService;
  return { alerts: new MatchAlertsService({} as MatchAlertsStore, notifications), calls };
}

describe('delivering what a run raised', () => {
  it('passes again while a full page was due, then stops at a short one', async () => {
    const { alerts, calls } = service([
      { due: 100, carried: 100 },
      { due: 100, carried: 100 },
      { due: 37, carried: 37 },
    ]);
    await alerts.deliver(['a', 'b']);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.userIds.join() === 'a,b')).toBe(true);
  });

  it('stops when a pass claims nothing, so a stuck page cannot hold the job', async () => {
    const { alerts, calls } = service([
      { due: 100, carried: 0 },
      { due: 100, carried: 0 },
    ]);
    await alerts.deliver(['a']);
    expect(calls).toHaveLength(1);
  });

  it('carries nothing for nobody', async () => {
    const { alerts, calls } = service([]);
    await alerts.deliver([]);
    expect(calls).toHaveLength(0);
  });
});
