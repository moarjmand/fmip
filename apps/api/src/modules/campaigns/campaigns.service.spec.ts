import { describe, expect, it, vi } from 'vitest';
import type { NotificationsService } from '../notifications/notifications.service';
import { CampaignsService, EMIT_PAGE, outcomesOf } from './campaigns.service';
import type { PostgresCampaignStore, SendOutcome } from './internal/campaign-store';

/**
 * Campaign emission a page at a time (T-903, D-107): one inbox statement and
 * one outcome statement per page, every member in exactly one page, and a
 * page the inbox could not write counted as failed without stopping the rest.
 */
describe('outcomesOf', () => {
  it('names the written members and leaves the rest to the store', () => {
    expect(outcomesOf(['a', 'b', 'c'], { now: ['a'], delayed: ['c'] })).toEqual([
      'sent',
      null,
      'delayed',
    ]);
  });

  it('fails the whole page when the inbox wrote nothing', () => {
    expect(outcomesOf(['a', 'b'], null)).toEqual(['failed', 'failed']);
  });
});

describe('CampaignsService.send', () => {
  const campaignRow = (started: boolean) => ({
    id: 'c1',
    audience_id: 'a1',
    audience_name: 'All',
    title: 'T',
    body: 'B',
    path: '/scores',
    created_by: 'admin',
    reason: 'r',
    created_at: new Date(0),
    started_by: started ? 'admin' : null,
    started_at: started ? new Date(0) : null,
    audience_size: started ? 1201 : null,
    dispatch_reason: started ? 'r' : null,
    finished_at: started ? new Date(0) : null,
    reached: null,
    delayed: null,
    muted: null,
    duplicate: null,
    failed: null,
  });

  it('writes each page in two statements and adds up what every page says', async () => {
    const members = Array.from({ length: EMIT_PAGE * 2 + 201 }, (_, i) => `m${String(i)}`);
    let campaignReads = 0;
    const recorded: string[][] = [];
    const store = {
      campaign: vi.fn(async () => campaignRow(campaignReads++ > 0)),
      audience: vi.fn(async () => ({ id: 'a1', filter: {} })),
      members: vi.fn(async () => members),
      claimDispatch: vi.fn(async () => true),
      recordPage: vi.fn(async (_id: string, page: string[], outcomes: (SendOutcome | null)[]) => {
        recorded.push(page);
        const counts: Partial<Record<SendOutcome, number>> = {};
        for (const outcome of outcomes) {
          const resolved = outcome ?? 'muted';
          counts[resolved] = (counts[resolved] ?? 0) + 1;
        }
        return counts;
      }),
      finishDispatch: vi.fn(async () => undefined),
    };
    let page = 0;
    const notifications = {
      // Page one: everyone now. Page two: the inbox failed. Page three: one held, the rest muted.
      emitToAudience: vi.fn(async (_request: unknown, userIds: string[]) => {
        page += 1;
        if (page === 1) return { now: userIds, delayed: [] };
        if (page === 2) return null;
        return { now: [], delayed: userIds.slice(0, 1) };
      }),
      drain: vi.fn(async () => ({ carried: EMIT_PAGE, stopped: 'drained' })),
    };
    const service = new CampaignsService(
      store as unknown as PostgresCampaignStore,
      notifications as unknown as NotificationsService,
    );

    const result = await service.send('c1', 'admin', 'go');

    expect(result.outcome).toBe('sent');
    expect(notifications.emitToAudience).toHaveBeenCalledTimes(3);
    expect(store.recordPage).toHaveBeenCalledTimes(3);
    expect(recorded.flat()).toEqual(members);
    expect(recorded.map((p) => p.length)).toEqual([EMIT_PAGE, EMIT_PAGE, 201]);
    expect(store.finishDispatch).toHaveBeenCalledWith('c1', 'admin', 'go', {
      reached: EMIT_PAGE,
      delayed: 1,
      muted: 200,
      duplicate: 0,
      failed: EMIT_PAGE,
    });
    // Only who may leave now is carried.
    expect(notifications.drain).toHaveBeenCalledWith({ userIds: members.slice(0, EMIT_PAGE) });
  });
});
