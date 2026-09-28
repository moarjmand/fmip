import type { MatchAlertKind } from '@fmip/contracts';

/**
 * What a match alert is, as pure functions over two readings of one match
 * (T-830, D-096): the state before a live write and the state after it.
 *
 * **Derived from the change, not from the state.** A kick-off is a match that
 * *was* scheduled and *is* live; a goal is a side's count going up. Reading
 * the state alone would announce every match in progress the first time the
 * job ran after a deploy.
 *
 * **Keyed so the same event is the same event.** A goal is "the home side's
 * second goal", not "the score became 2-1": two goals in one tick must not
 * invent an order the feed did not give, and a feed that goes 1-0, 0-0, 1-0
 * is one goal, one correction and one goal again -- the key carries an
 * occurrence (`#2`) for that last one. The key is the notification's dedupe
 * key, so a retry or a replay of the same state reaches nobody twice.
 */

export type Side = 'home' | 'away';

export const SIDES: readonly Side[] = ['home', 'away'];

/** The incidents an alert can be about, as stored. */
export interface MatchIncident {
  sequence: number;
  kind: string;
  side: Side | null;
  personId: string | null;
  /** How the feed named the player; null when the person row has no name to give. */
  personName: string | null;
  minute: number;
  addedTime: number | null;
}

/** One reading of a match. */
export interface MatchState {
  status: string;
  /** The current score, or null before the feed has supplied one. */
  score: { home: number; away: number } | null;
  incidents: MatchIncident[];
}

/** An event before it has a key. */
export type MatchEvent =
  | { kind: 'kickoff' }
  | { kind: 'goal'; side: Side; count: number }
  /** The side's `count`th goal is no longer on the board: disallowed, or a correction. */
  | { kind: 'goal_void'; side: Side; count: number }
  | { kind: 'red_card'; incident: MatchIncident }
  | { kind: 'half_time' }
  | { kind: 'full_time' };

/** An event with its key: what `match_alert` and the dedupe index hold. */
export interface KeyedEvent {
  key: string;
  /** The notification kind; a correction is a `match_goal` (D-096). */
  kind: MatchAlertKind;
  event: MatchEvent;
  /** For a correction, the key of the goal it withdraws. */
  withdraws: string | null;
}

const SENT_OFF = new Set(['red_card', 'second_yellow_card']);
const SCORED = new Set(['goal', 'penalty_goal']);

/** Whether a reading is of a match being played, or one that has just ended. */
function inPlay(before: MatchState, after: MatchState): boolean {
  return after.status === 'live' || (before.status === 'live' && after.status === 'finished');
}

/**
 * The events between two readings, in the order a member should read them.
 *
 * `halfTimeBreak` is the feed saying the match is at the interval; absent
 * means it did not say, and then there is no half-time alert -- a half-time
 * score appearing is not the interval (API-Football fills it during the first
 * half), and an alert the feed did not support would be invented.
 */
export function deriveMatchEvents(
  before: MatchState,
  after: MatchState,
  hints: { halfTimeBreak?: boolean } = {},
): MatchEvent[] {
  const events: MatchEvent[] = [];
  if (before.status === 'scheduled' && after.status === 'live') events.push({ kind: 'kickoff' });

  if (inPlay(before, after) && after.score !== null) {
    for (const side of SIDES) {
      const was = before.score?.[side] ?? 0;
      const now = after.score[side];
      for (let n = was + 1; n <= now; n += 1) events.push({ kind: 'goal', side, count: n });
      for (let n = was; n > now; n -= 1) events.push({ kind: 'goal_void', side, count: n });
    }
  }

  if (inPlay(before, after)) {
    const sentOffBefore = new Set(
      before.incidents
        .filter((i) => SENT_OFF.has(i.kind) && i.personId !== null)
        .map((i) => i.personId),
    );
    for (const incident of after.incidents) {
      if (!SENT_OFF.has(incident.kind) || incident.personId === null) continue;
      if (sentOffBefore.has(incident.personId)) continue;
      // One sending-off per player per match, whichever card it came from.
      sentOffBefore.add(incident.personId);
      events.push({ kind: 'red_card', incident });
    }
  }

  if (hints.halfTimeBreak === true && after.status === 'live') events.push({ kind: 'half_time' });
  if (before.status === 'live' && after.status === 'finished') events.push({ kind: 'full_time' });
  return events;
}

const goalKey = (fixtureId: string, side: Side, count: number, occurrence: number): string =>
  `${fixtureId}:goal:${side}:${count}#${occurrence}`;
const voidKey = (fixtureId: string, side: Side, count: number, occurrence: number): string =>
  `${fixtureId}:goal-void:${side}:${count}#${occurrence}`;

/**
 * Keys for the events, against the keys this match already has. An event
 * whose key exists is dropped here: it has been seen, and whoever was told
 * was told. `history` is extended as events are keyed, so two in one batch
 * see each other.
 */
export function keyEvents(
  fixtureId: string,
  events: MatchEvent[],
  history: Set<string>,
): KeyedEvent[] {
  const keyed: KeyedEvent[] = [];
  const add = (entry: KeyedEvent): void => {
    history.add(entry.key);
    keyed.push(entry);
  };

  for (const event of events) {
    switch (event.kind) {
      case 'kickoff':
      case 'half_time':
      case 'full_time': {
        const key = `${fixtureId}:${event.kind.replace('_', '-')}`;
        if (!history.has(key)) add({ key, kind: `match_${event.kind}`, event, withdraws: null });
        break;
      }
      case 'red_card': {
        const key = `${fixtureId}:red:${event.incident.personId ?? ''}`;
        if (!history.has(key)) add({ key, kind: 'match_red_card', event, withdraws: null });
        break;
      }
      case 'goal': {
        // The first occurrence that is not standing: a goal that was
        // withdrawn and is back is a new goal, and one still standing is
        // the same goal seen again.
        let occurrence = 1;
        for (;;) {
          const key = goalKey(fixtureId, event.side, event.count, occurrence);
          if (!history.has(key)) {
            add({ key, kind: 'match_goal', event, withdraws: null });
            break;
          }
          if (!history.has(voidKey(fixtureId, event.side, event.count, occurrence))) break;
          occurrence += 1;
        }
        break;
      }
      case 'goal_void': {
        // The latest occurrence of that goal, if it was ever announced and
        // is not already withdrawn. A goal nobody was told about needs no
        // correction.
        let occurrence = 0;
        while (history.has(goalKey(fixtureId, event.side, event.count, occurrence + 1))) {
          occurrence += 1;
        }
        if (occurrence === 0) break;
        const key = voidKey(fixtureId, event.side, event.count, occurrence);
        if (history.has(key)) break;
        add({
          key,
          kind: 'match_goal',
          event,
          withdraws: goalKey(fixtureId, event.side, event.count, occurrence),
        });
        break;
      }
    }
  }
  return keyed;
}

/**
 * Who scored the side's `count`th goal, when the incidents say so without
 * doubt, else null: the scorer is named only when the side's recorded goals
 * are exactly as many as its score and the match has no own goal (a feed
 * that credits an own goal to either side would otherwise shift every name
 * after it). Never a guess (rule 3).
 */
export function scorerOf(state: MatchState, side: Side, count: number): MatchIncident | null {
  if (state.score === null) return null;
  if (state.incidents.some((i) => i.kind === 'own_goal')) return null;
  const goals = state.incidents
    .filter((i) => SCORED.has(i.kind) && i.side === side)
    .sort((a, b) => a.sequence - b.sequence);
  if (goals.length !== state.score[side]) return null;
  const goal = goals[count - 1];
  return goal === undefined || goal.personName === null ? null : goal;
}

function minuteOf(incident: MatchIncident): string {
  return incident.addedTime === null
    ? `${String(incident.minute)}'`
    : `${String(incident.minute)}+${String(incident.addedTime)}'`;
}

function scoreline(teams: { home: string; away: string }, state: MatchState): string {
  return state.score === null
    ? `${teams.home} v ${teams.away}`
    : `${teams.home} ${String(state.score.home)}–${String(state.score.away)} ${teams.away}`;
}

/**
 * The line a member reads, written once when the event is seen and kept with
 * it: the teams, the score as it stands, and the scorer or the player sent
 * off where the feed named them. English, as every notification line is
 * today (the contract's sentences are); the inbox and the push read it.
 */
export function eventLine(
  event: MatchEvent,
  teams: { home: string; away: string },
  after: MatchState,
): string {
  const board = scoreline(teams, after);
  switch (event.kind) {
    case 'kickoff':
      return `Kick-off: ${teams.home} v ${teams.away}.`;
    case 'half_time':
      return `Half-time: ${board}.`;
    case 'full_time':
      return `Full-time: ${board}.`;
    case 'goal': {
      const scorer = scorerOf(after, event.side, event.count);
      const who =
        scorer === null
          ? ''
          : ` (${scorer.personName ?? ''} ${minuteOf(scorer)}${scorer.kind === 'penalty_goal' ? ', penalty' : ''})`;
      return `Goal for ${teams[event.side]}${who}: ${board}.`;
    }
    case 'goal_void':
      return `Goal disallowed for ${teams[event.side]}: ${board}.`;
    case 'red_card': {
      const { incident } = event;
      const team = incident.side === null ? '' : ` (${teams[incident.side]})`;
      const how = incident.kind === 'second_yellow_card' ? ', second yellow' : '';
      const name = incident.personName ?? 'A player';
      return `Red card: ${name}${team} ${minuteOf(incident)}${how}. ${board}.`;
    }
  }
}

/** One push for several alerts: the first few lines, and how many more. */
export const BATCH_LINES = 3;

export function batchBody(lines: string[]): string {
  const shown = lines.slice(0, BATCH_LINES);
  const rest = lines.length - shown.length;
  return rest > 0 ? `${shown.join('\n')}\n+${String(rest)} more` : shown.join('\n');
}
