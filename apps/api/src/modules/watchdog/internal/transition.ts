import type { WatchdogEventKind, WatchdogLevel } from '@fmip/contracts';
import type { Reading } from './conditions';

/** A condition as the previous tick left it. */
export interface StoredCondition {
  key: string;
  level: WatchdogLevel;
  since: Date;
  observed: number | null;
  /** The open incident's `raised` event id, or `null`. */
  incidentId: number | null;
}

/** What one reading changes: the new state, and the event to log if the level moved. */
export interface Step {
  level: WatchdogLevel;
  since: Date;
  /**
   * The incident the condition is in after this step. `'new'` when this
   * step's own event opens it (the id is only known once the event is written).
   */
  incident: number | null | 'new';
  event: {
    from: WatchdogLevel;
    to: WatchdogLevel;
    kind: WatchdogEventKind;
    /** The incident the event belongs to; `'new'` for a `raised` event. */
    incident: number | null | 'new';
  } | null;
}

const bad = (level: WatchdogLevel): boolean => level === 'degraded' || level === 'failing';

/**
 * The transition rule (T-801): an alert is a change, never a repeat.
 *
 * - The same level as last tick: no event, `since` kept.
 * - The first reading of a condition: an event only if it is bad (`raised`);
 *   a first `ok` or `unknown` is a baseline, not news.
 * - Into `degraded`/`failing` with no incident open: `raised`, which opens one.
 *   With one open: `escalated` (to failing) or `eased` (to degraded).
 * - Into `ok` with an incident open: `recovered`, which closes it. Without one
 *   (from `unknown`): `observable`.
 * - Into `unknown`: `unobservable`. The incident stays open -- a condition
 *   that could not be read has not recovered, and when it is read again and is
 *   still bad no second `raised` goes out.
 *
 * So one incident is exactly one `raised` and at most one `recovered`, however
 * many ticks it lasts and however it moves between degraded, failing and
 * unknown on the way.
 */
export function step(previous: StoredCondition | null, reading: Reading, now: Date): Step {
  const to = reading.level;

  if (previous === null) {
    if (!bad(to)) return { level: to, since: now, incident: null, event: null };
    return {
      level: to,
      since: now,
      incident: 'new',
      event: { from: 'unknown', to, kind: 'raised', incident: 'new' },
    };
  }

  const from = previous.level;
  if (from === to) {
    return { level: to, since: previous.since, incident: previous.incidentId, event: null };
  }

  const open = previous.incidentId;
  if (bad(to)) {
    if (open === null) {
      return {
        level: to,
        since: now,
        incident: 'new',
        event: { from, to, kind: 'raised', incident: 'new' },
      };
    }
    return {
      level: to,
      since: now,
      incident: open,
      event: { from, to, kind: to === 'failing' ? 'escalated' : 'eased', incident: open },
    };
  }

  if (to === 'ok') {
    return {
      level: to,
      since: now,
      incident: null,
      event: { from, to, kind: open === null ? 'observable' : 'recovered', incident: open },
    };
  }

  // to === 'unknown'
  return {
    level: to,
    since: now,
    incident: open,
    event: { from, to, kind: 'unobservable', incident: open },
  };
}

/** The two kinds an administrator is told about (T-802). */
export function isAlert(kind: WatchdogEventKind): boolean {
  return kind === 'raised' || kind === 'recovered';
}
