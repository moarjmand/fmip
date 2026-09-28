import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WatchdogEvent, WatchdogFreshness, WatchdogReport } from '@fmip/contracts';
import { INGEST_THRESHOLDS } from './internal/conditions';
import { WATCHDOG_PROBES, type WatchdogProbes } from './internal/probes';
import { readingsOf } from './internal/readings';
import { step } from './internal/transition';
import { WatchdogStore } from './internal/watchdog-store';

/** One tick a minute: an outage reaches an administrator within minutes (Phase 8's exit criteria). */
export const WATCHDOG_INTERVAL_SECONDS = 60;
/** The report is `stale` when the newest tick is older than this many intervals (rule 4). */
export const STALE_AFTER_INTERVALS = 3;
const REPORT_EVENTS = 50;

/**
 * The watchdog (T-801). Public surface: `tick` (the scheduled job), `report`
 * (`GET /admin/health/watchdog`), and `alertsAfter`, which is the contract the
 * alert delivery (T-802) reads -- `raised` and `recovered` events after the
 * last id it delivered, oldest first.
 *
 * A tick reads every health view first, then, holding one advisory lock in
 * one transaction, compares each reading with the previous state and writes
 * an event only where the level changed. The observations are read outside
 * the transaction so a slow model service does not hold a connection.
 */
@Injectable()
export class WatchdogService {
  private readonly log = new Logger('Watchdog');

  constructor(
    private readonly store: WatchdogStore,
    @Inject(WATCHDOG_PROBES) private readonly probes: WatchdogProbes,
  ) {}

  /** Evaluates every condition once. `null` when another tick held the lock. */
  async tick(
    now: Date = new Date(),
  ): Promise<{ conditions: number; events: WatchdogEvent[] } | null> {
    const observations = await this.probes.observe(now);
    const outcome = await this.store.locked(async (client) => {
      const previous = await this.store.previous(client);
      const readings = readingsOf(observations, previous, now, Object.keys(INGEST_THRESHOLDS));
      const events: WatchdogEvent[] = [];
      for (const reading of readings) {
        const next = step(previous.get(reading.key) ?? null, reading, now);
        let incident = next.incident === 'new' ? null : next.incident;
        if (next.event !== null) {
          const written = await this.store.writeEvent(client, {
            condition: reading.key,
            at: now,
            ...next.event,
            observed: reading.observed,
            note: reading.note,
          });
          if (next.incident === 'new') incident = written.id;
          events.push(written);
        }
        await this.store.saveCondition(
          client,
          reading,
          { level: next.level, since: next.since, incident },
          now,
        );
      }
      return { conditions: readings.length, events };
    });

    if (outcome === null) {
      this.log.warn('watchdog tick skipped: another tick holds the lock', {
        event: 'watchdog.skipped',
      });
      return null;
    }
    for (const event of outcome.events) {
      const fields = {
        event: `watchdog.${event.kind}`,
        condition: event.condition,
        from: event.from,
        to: event.to,
        incident: event.incident,
        observed: event.observed,
        note: event.note,
      };
      const message = `watchdog ${event.kind}: ${event.condition} ${event.from} -> ${event.to}`;
      if (event.to === 'failing' || event.to === 'degraded') this.log.error(message, fields);
      else this.log.log(message, fields);
    }
    return outcome;
  }

  async report(now: Date = new Date()): Promise<WatchdogReport> {
    const [conditions, events] = await Promise.all([
      this.store.conditions(),
      this.store.events(REPORT_EVENTS),
    ]);
    const newest = conditions.reduce<string | null>(
      (latest, c) => (latest === null || c.checked_at > latest ? c.checked_at : latest),
      null,
    );
    return {
      generated_at: now.toISOString(),
      checked_at: newest,
      interval_seconds: WATCHDOG_INTERVAL_SECONDS,
      freshness: freshnessOf(newest, now),
      conditions,
      events,
    };
  }

  /** `raised` and `recovered` events with an id above `afterId`, oldest first (T-802). */
  alertsAfter(afterId: number, limit = 100): Promise<WatchdogEvent[]> {
    return this.store.alertsAfter(afterId, limit);
  }
}

/** `never_run` with no tick, `stale` past three intervals, else `current`. */
export function freshnessOf(checkedAt: string | null, now: Date): WatchdogFreshness {
  if (checkedAt === null) return 'never_run';
  const age = now.getTime() - Date.parse(checkedAt);
  return age > STALE_AFTER_INTERVALS * WATCHDOG_INTERVAL_SECONDS * 1000 ? 'stale' : 'current';
}
