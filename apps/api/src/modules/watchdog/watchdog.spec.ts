import type { CandidateShadowHealth } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_THRESHOLD,
  CANDIDATE_SHADOW_THRESHOLD,
  DATA_QUALITY_STALE_SECONDS,
  DATA_QUALITY_THRESHOLD,
  DELIVERY_THRESHOLD,
  ELO_SOURCE_THRESHOLD,
  INGEST_THRESHOLDS,
  LIVE_FEED_THRESHOLD,
  MODEL_SERVICE_THRESHOLD,
  QUEUE_FAILURE_THRESHOLD,
  REQUEST_BUDGET_THRESHOLD,
  RESTORE_DRILL_THRESHOLD,
  type Reading,
  type RunRecord,
  backup,
  candidateShadow,
  dataQuality,
  deliveryChannel,
  eloSource,
  ingestJob,
  levelOf,
  liveFeed,
  modelService,
  queueFailures,
  requestBudget,
  restoreDrill,
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

describe('elo_source (T-920, D-111)', () => {
  const DAY = 24 * 60 * 60;
  const failingSince = (seconds: number, succeeded: boolean) => ({
    source: {
      refresh: true,
      state: 'recorded' as const,
      last_succeeded_day: succeeded ? '2026-09-24' : null,
      last_error: "HTTPStatusError: Server error '502 Bad Gateway'",
      last_error_at: '2026-09-28T06:00:12.000Z',
      unanswered_since: ago(seconds).toISOString(),
      detail: null,
    },
  });

  it('is degraded after three days without an answer, failing after fourteen', () => {
    expect(eloSource(failingSince(3 * DAY - 60, true), NOW).level).toBe('ok');
    const degraded = eloSource(failingSince(3 * DAY, true), NOW);
    expect(degraded).toMatchObject({ key: 'elo_source', level: 'degraded', observed: 3 * DAY });
    expect(degraded.note).toContain('Club Elo last answered for 2026-09-24');
    expect(degraded.note).toContain('last error 2026-09-28 06:00 UTC');
    expect(degraded.note).toContain('502 Bad Gateway');
    expect(eloSource(failingSince(14 * DAY, true), NOW).level).toBe('failing');
    expect(ELO_SOURCE_THRESHOLD.degraded).toBe(3 * DAY);
  });

  it('counts from the first failed ask when the source never answered', () => {
    const reading = eloSource(failingSince(4 * DAY, false), NOW);
    expect(reading).toMatchObject({ level: 'degraded' });
    expect(reading.note).toContain('never answered');
  });

  it('is ok when the source is retired on purpose, unknown when it cannot be judged', () => {
    const off = failingSince(30 * DAY, false);
    expect(eloSource({ source: { ...off.source, refresh: false } }, NOW)).toMatchObject({
      level: 'ok',
      observed: null,
    });
    expect(eloSource({ configured: false }, NOW).level).toBe('unknown');
    expect(eloSource({ unreadable: 'unreachable: refused' }, NOW).level).toBe('unknown');
    expect(eloSource({ source: null }, NOW).level).toBe('unknown');
    const never = { ...off.source, unanswered_since: null };
    expect(eloSource({ source: never }, NOW).level).toBe('unknown');
    const blind = { ...off.source, state: 'unreadable' as const, detail: 'connection refused' };
    expect(eloSource({ source: blind }, NOW)).toMatchObject({ level: 'unknown' });
  });

  it('a loader failing for days raises one incident, however many ticks see it, and recovers once', () => {
    // The health check every minute, over four days of 502s: one raised
    // event, then the same level again and again, which is no event (D-095).
    let previous: StoredCondition | null = null;
    const events: string[] = [];
    for (let minute = 0; minute <= 4 * 24 * 60; minute += 30) {
      const at = new Date(NOW.getTime() + minute * 60_000);
      const reading = eloSource(failingSince(3 * DAY - 3600 + minute * 60, true), at);
      const next = step(previous, reading, at);
      if (next.event !== null) events.push(next.event.kind);
      previous = {
        key: 'elo_source',
        level: next.level,
        since: next.since,
        observed: reading.observed,
        incidentId: next.incident === 'new' ? 1 : next.incident,
      };
    }
    expect(events).toEqual(['raised']);
    // Club Elo answers again: the count restarts from the new success.
    const answered = eloSource(failingSince(60, true), NOW);
    expect(step(previous, answered, NOW).event?.kind).toBe('recovered');
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

const NONE: RunRecord = { lastSucceededAt: null, newest: null };
const passed = (at: Date): RunRecord => ({
  lastSucceededAt: at,
  newest: { at, ok: true, detail: null },
});

describe('backup', () => {
  it('is unknown when the record cannot be read, or nothing was ever recorded here', () => {
    expect(backup(undefined, NOW)).toMatchObject({ level: 'unknown', observed: null });
    expect(backup(NONE, NOW)).toMatchObject({ level: 'unknown', observed: null });
    expect(backup(NONE, NOW).note).toMatch(/fmip-backup\.timer/);
  });

  it('is measured from the newest successful backup: 26 hours degraded, 50 failing', () => {
    expect(backup(passed(ago(3600)), NOW)).toMatchObject({ level: 'ok', observed: 3600 });
    expect(backup(passed(ago(BACKUP_THRESHOLD.degraded)), NOW).level).toBe('degraded');
    expect(backup(passed(ago(BACKUP_THRESHOLD.failing)), NOW).level).toBe('failing');
  });

  it('is failing when runs are on record and none succeeded', () => {
    const seen: RunRecord = {
      lastSucceededAt: null,
      newest: { at: ago(60), ok: false, detail: 'backup.sh stopped with status 1 during: pg_dump' },
    };
    expect(backup(seen, NOW)).toMatchObject({ level: 'failing', observed: null });
    expect(backup(seen, NOW).note).toMatch(/pg_dump/);
  });

  it('a newest run that failed is degraded at once, not when the age catches up (T-805)', () => {
    const seen = (lastOk: Date): RunRecord => ({
      lastSucceededAt: lastOk,
      newest: { at: ago(60), ok: false, detail: 'during: off-provider copy' },
    });
    expect(backup(seen(ago(3600)), NOW)).toMatchObject({ level: 'degraded', observed: 3600 });
    expect(backup(seen(ago(3600)), NOW).note).toMatch(/newest backup failed: during: off-provider/);
    expect(backup(seen(ago(BACKUP_THRESHOLD.failing)), NOW).level).toBe('failing');
  });

  it('keeps a long failure detail to a readable note', () => {
    const seen: RunRecord = {
      lastSucceededAt: ago(60),
      newest: { at: ago(10), ok: false, detail: 'x'.repeat(2000) },
    };
    expect(backup(seen, NOW).note?.length).toBeLessThan(400);
  });
});

describe('restore_drill', () => {
  const DAY = 24 * 3600;

  it('is unknown when the record cannot be read, or no drill was ever recorded here', () => {
    expect(restoreDrill(undefined, NOW)).toMatchObject({ key: 'restore_drill', level: 'unknown' });
    expect(restoreDrill(NONE, NOW)).toMatchObject({ level: 'unknown', observed: null });
    expect(restoreDrill(NONE, NOW).note).toMatch(/fmip-restore-drill\.timer/);
  });

  it('is measured from the newest drill that passed: degraded past 35 days, failing past 70', () => {
    expect(RESTORE_DRILL_THRESHOLD).toEqual({
      unit: 'seconds',
      degraded: 35 * DAY,
      failing: 70 * DAY,
    });
    expect(restoreDrill(passed(ago(7 * DAY)), NOW)).toMatchObject({
      level: 'ok',
      observed: 7 * DAY,
    });
    expect(restoreDrill(passed(ago(35 * DAY)), NOW).level).toBe('degraded');
    expect(restoreDrill(passed(ago(70 * DAY)), NOW).level).toBe('failing');
  });

  it('is failing when the newest drill failed, however recent the last pass', () => {
    const seen: RunRecord = {
      lastSucceededAt: ago(28 * DAY),
      newest: { at: ago(60), ok: false, detail: 'offsite; row counts differ from the manifest' },
    };
    expect(restoreDrill(seen, NOW)).toMatchObject({ level: 'failing', observed: 28 * DAY });
    expect(restoreDrill(seen, NOW).note).toMatch(/row counts differ/);
    expect(
      restoreDrill(
        { lastSucceededAt: null, newest: { at: ago(60), ok: false, detail: null } },
        NOW,
      ),
    ).toMatchObject({ level: 'failing', observed: null });
  });

  it('an unreadable record makes both backup conditions unknown with the reason', () => {
    const readings = readingsOf(
      {
        ingest: [],
        live: { inProgress: 0, oldestChangeAt: null, behind: 0 },
        budget: { requestsToday: 0, budget: null },
        queues: [],
        model: { configured: false },
        delivery: { email: { configured: false }, push: { configured: false } },
        dataQuality: { open: 0, sweptAt: ago(60) },
        backups: { unreadable: 'relation "backup_run" does not exist' },
      },
      new Map(),
      NOW,
      [],
    );
    for (const key of ['backup', 'restore_drill']) {
      expect(readings.find((r) => r.key === key)).toMatchObject({
        level: 'unknown',
        note: 'relation "backup_run" does not exist',
      });
    }
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

describe('data_quality', () => {
  it('counts open findings about live matches: one is degraded, three failing', () => {
    expect(DATA_QUALITY_THRESHOLD).toEqual({ unit: 'count', degraded: 1, failing: 3 });
    expect(dataQuality({ open: 0, sweptAt: ago(60) }, NOW)).toMatchObject({
      key: 'data_quality',
      level: 'ok',
      observed: 0,
    });
    expect(dataQuality({ open: 1, sweptAt: ago(60) }, NOW).level).toBe('degraded');
    expect(dataQuality({ open: 3, sweptAt: ago(60) }, NOW).level).toBe('failing');
  });

  it('is unknown, not ok, when the sweep never ran or stopped', () => {
    expect(dataQuality({ open: 0, sweptAt: null }, NOW)).toMatchObject({
      level: 'unknown',
      note: 'the data-quality checks have not run yet',
    });
    expect(
      dataQuality({ open: 5, sweptAt: ago(DATA_QUALITY_STALE_SECONDS + 60) }, NOW),
    ).toMatchObject({
      level: 'unknown',
      observed: null,
      note: 'the newest data-quality sweep is 16 minutes old',
    });
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
    dataQuality: { open: 0, sweptAt: ago(60) },
    backups: { backup: NONE, drill: NONE },
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
      'elo_source',
      'delivery:email',
      'delivery:push',
      'data_quality',
      'backup',
      'restore_drill',
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

  it('an unreadable data-quality view is unknown with the reason', () => {
    const reading = readingsOf(
      observations({ dataQuality: { unreadable: 'relation does not exist' } }),
      new Map(),
      NOW,
      [],
    ).find((r) => r.key === 'data_quality');
    expect(reading).toMatchObject({ level: 'unknown', note: 'relation does not exist' });
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

  it('reads through readingsOf from the model health check, unknown when that check failed', () => {
    const seen = readingsOf(
      observations({
        elo: {
          source: {
            refresh: true,
            state: 'recorded',
            last_succeeded_day: '2026-09-24',
            last_error: null,
            last_error_at: null,
            unanswered_since: ago(5 * 24 * 3600).toISOString(),
            detail: null,
          },
        },
      }),
      new Map(),
      NOW,
      [],
    ).find((r) => r.key === 'elo_source');
    expect(seen?.level).toBe('degraded');
    const blind = readingsOf(
      observations({ elo: { unreadable: 'http: 500' } }),
      new Map(),
      NOW,
      [],
    ).find((r) => r.key === 'elo_source');
    expect(blind?.level).toBe('unknown');
  });
});

describe('candidate:<version> (T-1165)', () => {
  const health = (asked: number, failed: number): CandidateShadowHealth => ({
    first_answered_at: ago(10 * 24 * 3600).toISOString(),
    last_answered_at: ago(3600).toISOString(),
    day: { asked, failed },
    last_failure: failed === 0 ? null : { at: ago(60).toISOString(), fixture_id: 'f' },
  });
  const inShadow = (h: CandidateShadowHealth | undefined) =>
    ({ state: 'in_shadow', health: h }) as const;

  it('raises only when every forecast of the day stored nothing', () => {
    expect(CANDIDATE_SHADOW_THRESHOLD).toEqual({ unit: 'percent', degraded: 100, failing: 100 });
    const all = candidateShadow('c@0.6.0', inShadow(health(4, 4)));
    expect(all).toMatchObject({ key: 'candidate:c@0.6.0', level: 'failing', observed: 100 });
    expect(all.note).toContain('4 of 4');
    expect(all.note).toContain('forecast.shadow_failed');
    expect(candidateShadow('c@0.6.0', inShadow(health(4, 3)))).toMatchObject({
      level: 'ok',
      observed: 75,
    });
    // 299 of 300 is not every forecast, however it rounds.
    expect(candidateShadow('c@0.6.0', inShadow(health(300, 299))).level).toBe('ok');
  });

  it('says a candidate that has never answered, never zero failures', () => {
    for (const h of [undefined, { ...health(0, 0), first_answered_at: null }]) {
      const reading = candidateShadow('c@0.6.0', inShadow(h));
      expect(reading).toMatchObject({ level: 'unknown', observed: null });
      expect(reading.note).toContain('never answered');
    }
  });

  it('is ok with no forecast asked in the day, ok when it left shadow, unknown when unreadable', () => {
    expect(candidateShadow('c@0.6.0', inShadow(health(0, 0)))).toMatchObject({
      level: 'ok',
      observed: null,
    });
    expect(candidateShadow('c@0.6.0', { state: 'left' })).toMatchObject({
      level: 'ok',
      note: 'no longer in shadow',
    });
    expect(
      candidateShadow('c@0.6.0', { state: 'unreadable', reason: 'relation does not exist' }),
    ).toMatchObject({ level: 'unknown', note: 'relation does not exist' });
  });

  it('is one alert for a day of failures and one recovery on the first answer', () => {
    let state: StoredCondition | null = null;
    const kinds: string[] = [];
    for (const [asked, failed] of [
      [1, 0],
      [2, 1],
      [3, 3],
      [5, 5],
      [6, 5],
    ] as const) {
      const reading = candidateShadow('c@0.6.0', inShadow(health(asked, failed)));
      const next = step(state, reading, NOW);
      if (next.event !== null) kinds.push(next.event.kind);
      state = {
        key: reading.key,
        level: next.level,
        since: next.since,
        observed: reading.observed,
        incidentId: next.incident === 'new' ? 1 : next.incident,
      };
    }
    expect(kinds).toEqual(['raised', 'recovered']);
  });

  describe('through readingsOf', () => {
    const base: Observations = {
      ingest: [],
      live: { inProgress: 0, oldestChangeAt: null, behind: 0 },
      budget: { requestsToday: 0, budget: 100 },
      queues: [],
      model: { configured: true, ok: true },
      delivery: { email: { configured: false }, push: { configured: false } },
      dataQuality: { open: 0, sweptAt: ago(60) },
      backups: { unreadable: 'n/a' },
    };
    const candidates = (seen: Observations['candidates'], previous = new Map()) =>
      readingsOf({ ...base, candidates: seen }, previous, NOW, []).filter((r) =>
        r.key.startsWith('candidate:'),
      );

    it('reads each listed candidate, and nothing from a service that lists none', () => {
      const readings = candidates({
        offered: ['a@0.5.0', 'b@0.6.0'],
        health: new Map([['a@0.5.0', health(2, 2)]]),
      });
      expect(readings.map((r) => [r.key, r.level])).toEqual([
        ['candidate:a@0.5.0', 'failing'],
        ['candidate:b@0.6.0', 'unknown'],
      ]);
      expect(candidates({ offered: null, health: new Map() })).toEqual([]);
      expect(candidates(undefined)).toEqual([]);
      expect(candidates({ configured: false })).toEqual([]);
    });

    it('closes the incident of a candidate that left shadow; reads nothing while the list is unreadable', () => {
      const previous = new Map<string, StoredCondition>([
        [
          'candidate:gone@0.4.0',
          {
            key: 'candidate:gone@0.4.0',
            level: 'failing',
            since: ago(60),
            observed: 100,
            incidentId: 9,
          },
        ],
        [
          'candidate:old@0.3.0',
          {
            key: 'candidate:old@0.3.0',
            level: 'ok',
            since: ago(60),
            observed: null,
            incidentId: null,
          },
        ],
      ]);
      const readings = candidates({ offered: [], health: new Map() }, previous);
      expect(readings).toEqual([
        expect.objectContaining({ key: 'candidate:gone@0.4.0', level: 'ok' }),
      ]);
      expect(candidates({ unreadable: 'http: 500' }, previous)).toEqual([]);
      expect(
        candidates({ offered: ['gone@0.4.0'], health: { unreadable: 'timeout' } }, previous),
      ).toEqual([expect.objectContaining({ level: 'unknown', note: 'timeout' })]);
    });
  });
});

describe('the report freshness', () => {
  it('is never_run with no tick, current within three intervals, stale after', () => {
    expect(freshnessOf(null, NOW)).toBe('never_run');
    expect(freshnessOf(ago(170).toISOString(), NOW)).toBe('current');
    expect(freshnessOf(ago(181).toISOString(), NOW)).toBe('stale');
  });
});
