import type { MatchAlertKind } from '@fmip/contracts';
import type { Side } from './match-events';

/**
 * Team news as match alerts (T-832, D-100): the line-ups announced, and a
 * player the provider says will miss the match. Pure functions over two
 * readings of one match -- before and after the line-ups job wrote it --
 * in the manner of `match-events.ts`.
 *
 * **Derived from the change, not from the state.** The line-ups alert is the
 * moment both sides first have starters stored, so a match whose line-ups
 * were already here when this shipped is not announced, and a line-up the
 * feed corrects later is not announced again. A player is announced the
 * first time the provider lists them as `out` for that match; `doubtful` is
 * not news anybody can act on, and a player it stops listing is not
 * announced as fit -- the feed never says "fit" (T-103).
 *
 * **One key per event, forever.** `<fixture>:lineups` and
 * `<fixture>:out:<person>` are the `match_alert` keys and the notifications'
 * dedupe keys, so a retry, a second process or a player listed, dropped and
 * listed again reaches nobody twice.
 */

/** A player the provider lists for one match. */
export interface Absentee {
  personId: string;
  /** How the catalogue names them; null when the person row has no name. */
  name: string | null;
  /** Which side they would have played for; null when the club is not a side of this match. */
  side: Side | null;
  /** `injury`, `suspension`, `illness`, `other`, or null when the reason said nothing. */
  reason: string | null;
}

/** One reading of a match's team news. */
export interface TeamNewsState {
  status: string;
  /** Starters stored per side. */
  starters: { home: number; away: number };
  /** The players listed as `out` (not `doubtful`). */
  out: Absentee[];
}

export type TeamNewsEvent = { kind: 'lineups' } | { kind: 'out'; absentee: Absentee };

export interface KeyedTeamNews {
  key: string;
  kind: MatchAlertKind;
  event: TeamNewsEvent;
}

const announced = (state: TeamNewsState): boolean =>
  state.starters.home > 0 && state.starters.away > 0;

/**
 * The events between two readings. Nothing for a match that has finished or
 * was called off: a line-up arriving with the post-match detail is history,
 * not news. A player listed out is news only before kick-off.
 */
export function deriveTeamNews(before: TeamNewsState, after: TeamNewsState): TeamNewsEvent[] {
  const events: TeamNewsEvent[] = [];
  if (after.status !== 'scheduled' && after.status !== 'live') return events;
  if (announced(after) && !announced(before)) events.push({ kind: 'lineups' });
  if (after.status === 'scheduled') {
    const wasOut = new Set(before.out.map((a) => a.personId));
    for (const absentee of after.out) {
      // A player with no name is not announced as "somebody" (rule 3).
      if (absentee.name === null || wasOut.has(absentee.personId)) continue;
      events.push({ kind: 'out', absentee });
    }
  }
  return events;
}

/** Keys for the events against the keys this match already has; one already there is dropped. */
export function keyTeamNews(
  fixtureId: string,
  events: TeamNewsEvent[],
  history: Set<string>,
): KeyedTeamNews[] {
  const keyed: KeyedTeamNews[] = [];
  for (const event of events) {
    const key =
      event.kind === 'lineups'
        ? `${fixtureId}:lineups`
        : `${fixtureId}:out:${event.absentee.personId}`;
    if (history.has(key)) continue;
    history.add(key);
    keyed.push({
      key,
      kind: event.kind === 'lineups' ? 'match_lineups' : 'match_availability',
      event,
    });
  }
  return keyed;
}

const REASON: Record<string, string> = {
  injury: 'injured',
  suspension: 'suspended',
  illness: 'ill',
};

/** The line a member reads, written once with the event. English, as every match alert's line is (D-098). */
export function teamNewsLine(event: TeamNewsEvent, teams: { home: string; away: string }): string {
  const match = `${teams.home} v ${teams.away}`;
  if (event.kind === 'lineups') return `Line-ups are in: ${match}.`;
  const { absentee } = event;
  const club = absentee.side === null ? '' : ` (${teams[absentee.side]})`;
  const why = absentee.reason === null ? undefined : REASON[absentee.reason];
  return `Team news: ${absentee.name ?? ''}${club} will miss ${match}${why === undefined ? '' : `, ${why}`}.`;
}
