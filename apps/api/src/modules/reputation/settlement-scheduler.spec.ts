import { describe, expect, it, vi } from 'vitest';
import type { FailureCountsService } from '../failure-counts/failure-counts.service';
import type { SettlementService } from '../predictions/settlement.service';
import type { ReputationService } from './reputation.service';
import { SETTLEMENT_PASSES, SettlementSchedulerService } from './settlement-scheduler.service';

type Pass = { fixtures: number; settled: number; voided: number; fixtureIds: string[] };
const EMPTY: Pass = { fixtures: 0, settled: 0, voided: 0, fixtureIds: [] };

function scheduler(passes: Pass[]) {
  const settleDue = vi.fn();
  for (const pass of passes) settleDue.mockResolvedValueOnce(pass);
  settleDue.mockResolvedValue(EMPTY);
  const recomputeForFixture = vi.fn().mockResolvedValue({ users: 2, snapshots: 1 });
  const service = new SettlementSchedulerService(
    { settleDue } as unknown as SettlementService,
    { recomputeForFixture } as unknown as ReputationService,
    {} as FailureCountsService,
  );
  return { service, settleDue, recomputeForFixture };
}

describe('SettlementSchedulerService.tick (T-1380)', () => {
  it('settles what is due, then recomputes the members of exactly those fixtures', async () => {
    const { service, settleDue, recomputeForFixture } = scheduler([
      { fixtures: 2, settled: 3, voided: 1, fixtureIds: ['f1', 'f2'] },
    ]);
    await expect(service.tick()).resolves.toEqual({
      fixtures: 2,
      settled: 3,
      voided: 1,
      members: 4,
      snapshots: 2,
    });
    expect(settleDue).toHaveBeenCalledTimes(2);
    expect(recomputeForFixture.mock.calls).toEqual([['f1'], ['f2']]);
  });

  it('writes and recomputes nothing when nothing is due', async () => {
    const { service, settleDue, recomputeForFixture } = scheduler([]);
    await expect(service.tick()).resolves.toMatchObject({ fixtures: 0, members: 0 });
    expect(settleDue).toHaveBeenCalledOnce();
    expect(recomputeForFixture).not.toHaveBeenCalled();
  });

  it('stops after a pass that wrote nothing, so a stuck fixture is not asked again', async () => {
    const stuck: Pass = { fixtures: 1, settled: 0, voided: 0, fixtureIds: ['stuck'] };
    const { service, settleDue } = scheduler([stuck, stuck, stuck]);
    await service.tick();
    expect(settleDue).toHaveBeenCalledOnce();
  });

  it('drains a backlog over at most SETTLEMENT_PASSES passes per tick', async () => {
    const full: Pass = { fixtures: 50, settled: 50, voided: 0, fixtureIds: ['f'] };
    const { service, settleDue } = scheduler(Array.from({ length: 20 }, () => full));
    await service.tick();
    expect(settleDue).toHaveBeenCalledTimes(SETTLEMENT_PASSES);
  });
});
