import { describe, expect, it } from 'vitest';
import {
  BACKUP_THRESHOLD,
  DELIVERY_THRESHOLD,
  INGEST_THRESHOLDS,
  LIVE_FEED_THRESHOLD,
  MODEL_SERVICE_THRESHOLD,
  QUEUE_FAILURE_THRESHOLD,
  REQUEST_BUDGET_THRESHOLD,
  type Reading,
  backup,
  deliveryChannel,
  ingestJob,
  levelOf,
  liveFeed,
  modelService,
  queueFailures,
  requestBudget,
} from './internal/conditions';
import { type Observations, readingsOf } from './internal/readings';
import { type StoredCondition, isAlert, step } from './internal/transition';
import { freshnessOf } from './watchdog.service';

const NOW = new Date('2026-09-28T12:00:00Z');
const ago = (seconds: number): Date => new Date(NOW.getTime() - seconds * 1000);

describe('levelOf', () => {
  it('is ok below degraded, degraded from it, failing from failing', () => {
    const t = { unit: 'count' as const, degraded: 1, failing: 3 };
    expect(levelOf(0, t)).toBe('ok');
    expect(levelOf(1, t)).toBe('degraded');
    expect(levelOf(2, t)).toBe('degraded');
    expect(levelOf(3, t)).toBe('failing');
  });
});

describe('ingest:<job>', () => {
  const seen = (lastCompletedAt: Date | null, lastStartedAt: Date | null = lastCompletedAt) => ({
    provider: 'api_football',
    reason: null,
    lastCompletedAt,
    lastStartedAt,
  });

  it('measures seconds since the newest completed run against the job own thresholds', () => {
    const live = INGEST_THRESHOLDS.live!;
    expect(ingestJob('live', seen(ago(60)), NOW)).toMatchObject({
      key: 'ingest:live',
      level: 'ok',
      observed: 60,
    });
    expect(ingestJob('live', seen(ago(live.degraded)), NOW).level).toBe('degraded');
    expect(ingestJob('live', seen(ago(live.failing)), NOW).level).toBe('failing');
    // The same age is fine for an hourly job.
    expect(ingestJob('fixtures', seen(ago(live.failing)), NOW).level).toBe('ok');
  });

  it('is unknown with the reason when no source serves the job', () => {
    const reading = ingestJob(
      'lineups',
      {
        provider: null,
        reason: 'INGESTION_SOURCE=off',
        lastCompletedAt: null,
        lastStartedAt: null,
      },
      NOW,
    );
    expect(reading).toMatchObject({
      level: 'unknown',
      observed: null,
      note: 'INGESTION_SOURCE=off',
    });
  });

  it('is unknown before the first run, and failing when runs exist and none completed', () => {
    expect(ingestJob('live', seen(null, null), NOW).level).toBe('unknown');
    expect(ingestJob('live', seen(null, ago(30)), NOW).level).toBe('failing');
  });
});

describe('live_feed', () => {
  it('is ok with nothing in progress, and says so rather than measuring', () => {
    expect(liveFeed({ inProgress: 0, oldestChangeAt: null, behind: 0 }, NOW)).toMatchObject({
      level: 'ok',
      observed: null,
      note: 'no match in progress',
    });
  });

  it('does not fire at half-time: fifteen unchanged minutes are ok', () => {
    expect(liveFeed({ inProgress: 2, oldestChangeAt: ago(15 * 60), behind: 0 }, NOW).level).toBe(
      'ok',
    );
  });

  it('is degraded past twenty minutes and failing past forty', () => {
    const t = LIVE_FEED_THRESHOLD;
    expect(
      liveFeed({ inProgress: 3, oldestChangeAt: ago(t.degraded), behind: 1 }, NOW),
    ).toMatchObject({
      level: 'degraded',
      observed: t.degraded,
      note: '3 in progress, 1 unchanged for 20 minutes or more',
    });
    expect(liveFeed({ inProgress: 1, oldestChangeAt: ago(t.failing), behind: 1 }, NOW).level).toBe(
      'failing',
    );
  });
});

describe('request_budget', () => {
  it('is a percentage of the budget: 80 % degraded, 95 % failing', () => {
    expect(requestBudget({ requestsToday: 7000, budget: 10000 })).toMatchObject({
      level: 'ok',
      observed: 70,
    });
    expect(requestBudget({ requestsToday: 8000, budget: 10000 }).level).toBe('degraded');
    expect(requestBudget({ requestsToday: 9500, budget: 10000 }).level).toBe('failing');
    expect(REQUEST_BUDGET_THRESHOLD).toEqual({ unit: 'percent', degraded: 80, failing: 95 });
  });

  it('is unknown without a budget, never ok by default', () => {
    expect(requestBudget({ requestsToday: 5, budget: null })).toMatchObject({
      level: 'unknown',
      observed: null,
    });
  });
});

describe('jobs:<queue>', () => {
  it('counts failed jobs in the last hour: one degraded, three failing', () => {
    expect(queueFailures('ingestion', { failedLastHour: 0 }).level).toBe('ok');
    expect(queueFailures('ingestion', { failedLastHour: 1 }).level).toBe('degraded');
    expect(queueFailures('news', { failedLastHour: 3 })).toMatchObject({
      key: 'jobs:news',
      level: 'failing',
      observed: 3,
      threshold: QUEUE_FAILURE_THRESHOLD,
    });
  });

  it('is unknown when the queue could not be read', () => {
    expect(queueFailures('news', { unreadable: 'REDIS_URL is not set' })).toMatchObject({
      level: 'unknown',
      note: 'REDIS_URL is not set',
    });
  });
});

describe('model_service', () => {
  it('counts consecutive failed checks: one degraded, three failing, and an answer resets it', () => {
    const failed = {
      configured: true as const,
      ok: false as const,
      reason: 'unreachable: refused',
    };
    const first = modelService(failed, null);
    expect(first).toMatchObject({ level: 'degraded', observed: 1, note: 'unreachable: refused' });
    expect(modelService(failed, 2)).toMatchObject({ level: 'failing', observed: 3 });
    expect(modelService({ configured: true, ok: true }, 5)).toMatchObject({
      level: 'ok',
      observed: 0,
    });
    expect(MODEL_SERVICE_THRESHOLD.failing).toBe(3);
  });

  it('is unknown when the deployment has no model service', () => {
    expect(modelService({ configured: false }, null).level).toBe('unknown');
  });
});

describe('delivery:<channel>', () => {
  it('is unknown for a channel with no provider', () => {
    expect(deliveryChannel('email', { configured: false })).toMatchObject({
      key: 'delivery:email',
      level: 'unknown',
    });
  });

  it('does not judge fewer than three deliveries', () => {
    expect(deliveryChannel('push', { configured: true, sent: 0, failed: 2 })).toMatchObject({
      level: 'ok',
      observed: null,
    });
  });

  it('is the failed share: a quarter degraded, three quarters failing', () => {
    expect(deliveryChannel('push', { configured: true, sent: 9, failed: 1 }).level).toBe('ok');
    expect(deliveryChannel('push', { configured: true, sent: 3, failed: 1 })).toMatchObject({
      level: 'degraded',
      observed: 25,
    });
    expect(deliveryChannel('push', { configured: true, sent: 1, failed: 3 }).level).toBe('failing');
    expect(DELIVERY_THRESHOLD.unit).toBe('percent');
  });
});

describe('backup', () => {
  it('is unknown while the API has no backup record to read (T-805)', () => {
    expect(backup(undefined, NOW)).toMatchObject({ level: 'unknown', observed: null });
  });

  it('is measured from the newest successful backup: 26 hours degraded, 50 failing', () => {
    expect(backup(ago(3600), NOW).level).toBe('ok');
    expect(backup(ago(BACKUP_THRESHOLD.degraded), NOW).level).toBe('degraded');
    expect(backup(ago(BACKUP_THRESHOLD.failing), NOW).level).toBe('failing');
    expect(backup(null, NOW).level).toBe('failing');
  });
});

describe('the transition rule', () => {
  const reading = (level: Reading['level']): Reading => ({
    key: 'live_feed',
    level,
    observed: 1,
    threshold: LIVE_FEED_THRESHOLD,
    note: null,
  });
  const stored = (level: StoredCondition['level'], incidentId: number | null): StoredCondition => ({
    key: 'live_feed',
    level,
    since: ago(600),
    observed: 1,
    incidentId,
  });

  it('a first ok or unknown reading is a baseline, not an event', () => {
    expect(step(null, reading('ok'), NOW)).toEqual({
      level: 'ok',
      since: NOW,
      incident: null,
      event: null,
    });
    expect(step(null, reading('unknown'), NOW).event).toBeNull();
  });

  it('a first bad reading raises', () => {
    const next = step(null, reading('failing'), NOW);
    expect(next.event).toEqual({ from: 'unknown', to: 'failing', kind: 'raised', incident: 'new' });
    expect(next.incident).toBe('new');
  });

  it('the same level again is no event and keeps since', () => {
    const next = step(stored('degraded', 7), reading('degraded'), NOW);
    expect(next).toEqual({ level: 'degraded', since: ago(600), incident: 7, event: null });
  });

  it('ok to bad raises and opens an incident', () => {
    expect(step(stored('ok', null), reading('degraded'), NOW).event).toEqual({
      from: 'ok',
      to: 'degraded',
      kind: 'raised',
      incident: 'new',
    });
  });

  it('moves inside an open incident are escalated and eased, not raised again', () => {
    expect(step(stored('degraded', 7), reading('failing'), NOW).event).toEqual({
      from: 'degraded',
      to: 'failing',
      kind: 'escalated',
      incident: 7,
    });
    expect(step(stored('failing', 7), reading('degraded'), NOW).event?.kind).toBe('eased');
  });

  it('back to ok recovers and closes the incident', () => {
    const next = step(stored('failing', 7), reading('ok'), NOW);
    expect(next.event).toEqual({ from: 'failing', to: 'ok', kind: 'recovered', incident: 7 });
    expect(next.incident).toBeNull();
  });

  it('unknown keeps the incident open, and bad again after it is not a second alert', () => {
    const blind = step(stored('failing', 7), reading('unknown'), NOW);
    expect(blind.event?.kind).toBe('unobservable');
    expect(blind.incident).toBe(7);
    const again = step(stored('unknown', 7), reading('failing'), NOW);
    expect(again.event?.kind).toBe('escalated');
    expect(again.incident).toBe(7);
  });

  it('unknown to ok with no incident is observable, not a recovery', () => {
    expect(step(stored('unknown', null), reading('ok'), NOW).event?.kind).toBe('observable');
  });

  it('only raised and recovered are alerts', () => {
    expect(isAlert('raised')).toBe(true);
    expect(isAlert('recovered')).toBe(true);
    for (const kind of ['escalated', 'eased', 'unobservable', 'observable'] as const) {
      expect(isAlert(kind)).toBe(false);
    }
  });

  it('an incident that lasts an hour of ticks is one alert and one recovery', () => {
    const levels: Reading['level'][] = [
      'ok',
      ...Array<Reading['level']>(20).fill('degraded'),
      ...Array<Reading['level']>(20).fill('failing'),
      'unknown',
      ...Array<Reading['level']>(17).fill('failing'),
      'ok',
      'ok',
    ];
    let state: StoredCondition | null = null;
    const kinds: string[] = [];
    let nextId = 1;
    levels.forEach((level, i) => {
      const at = new Date(NOW.getTime() + i * 60_000);
      const next = step(state, reading(level), at);
      let incident = next.incident === 'new' ? null : next.incident;
      if (next.event !== null) {
        kinds.push(next.event.kind);
        const id = nextId++;
        if (next.incident === 'new') incident = id;
      }
      state = {
        key: 'live_feed',
        level: next.level,
        since: next.since,
        observed: 1,
        incidentId: incident,
      };
    });
    expect(kinds.filter((k) => isAlert(k as 'raised'))).toEqual(['raised', 'recovered']);
  });
});

describe('readingsOf', () => {
  const observations = (over: Partial<Observations> = {}): Observations => ({
    ingest: [
      {
        job: 'live',
        provider: 'api_football',
        reason: null,
        lastCompletedAt: ago(30),
        lastStartedAt: ago(30),
      },
    ],
    live: { inProgress: 0, oldestChangeAt: null, behind: 0 },
    budget: { requestsToday: 10, budget: 100 },
    queues: [{ queue: 'ingestion', failedLastHour: 0 }],
    model: { configured: true, ok: true },
    delivery: { email: { configured: false }, push: { configured: true, sent: 5, failed: 0 } },
    backup: undefined,
    ...over,
  });

  it('gives every condition a reading, keyed', () => {
    const keys = readingsOf(observations(), new Map(), NOW, ['live']).map((r) => r.key);
    expect(keys).toEqual([
      'ingest:live',
      'live_feed',
      'request_budget',
      'jobs:ingestion',
      'model_service',
      'delivery:email',
      'delivery:push',
      'backup',
    ]);
  });

  it('an unreadable view makes its own conditions unknown with the reason, and nothing else', () => {
    const readings = readingsOf(
      observations({
        ingest: { unreadable: 'connection refused' },
        live: { unreadable: 'timeout' },
      }),
      new Map(),
      NOW,
      ['live', 'fixtures'],
    );
    const byKey = new Map(readings.map((r) => [r.key, r]));
    expect(byKey.get('ingest:live')).toMatchObject({
      level: 'unknown',
      note: 'connection refused',
    });
    expect(byKey.get('ingest:fixtures')).toMatchObject({ level: 'unknown' });
    expect(byKey.get('live_feed')).toMatchObject({ level: 'unknown', note: 'timeout' });
    expect(byKey.get('request_budget')?.level).toBe('ok');
  });

  it('carries the model service failure count from the previous bad reading', () => {
    const previous = new Map<string, StoredCondition>([
      [
        'model_service',
        { key: 'model_service', level: 'degraded', since: ago(120), observed: 2, incidentId: 4 },
      ],
    ]);
    const failed = observations({ model: { configured: true, ok: false, reason: 'http: 500' } });
    const model = readingsOf(failed, previous, NOW, []).find((r) => r.key === 'model_service');
    expect(model).toMatchObject({ level: 'failing', observed: 3 });
  });
});

describe('the report freshness', () => {
  it('is never_run with no tick, current within three intervals, stale after', () => {
    expect(freshnessOf(null, NOW)).toBe('never_run');
    expect(freshnessOf(ago(170).toISOString(), NOW)).toBe('current');
    expect(freshnessOf(ago(181).toISOString(), NOW)).toBe('stale');
  });
});
