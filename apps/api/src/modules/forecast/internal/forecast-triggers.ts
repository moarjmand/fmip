/**
 * When a forecast version is due (T-120, blueprint 6.4).
 *
 * The blueprint asks for separate permanent forecasts before each match: an
 * early one on current availability, an updated one when predicted line-ups
 * arrive, a final one when official line-ups are confirmed, and a post-match
 * evaluation (which is T-066 and already exists).
 *
 * Pure: it is handed what is known about a fixture and answers with the kind
 * that is due, or with the reason none is. That makes "each kind is produced
 * once per fixture" a property of a function rather than a hope about a cron.
 */

import type { ForecastKind } from '@fmip/contracts';

/** How long before kick-off the early forecast is worth computing. */
export const EARLY_WINDOW_DAYS = 7;

/** After kick-off, nothing new is a *pre-match* forecast. */
export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface FixtureState {
  fixtureId: string;
  kickoffAt: Date;
  status: string;
  /** Whether a line-up is stored for either side. */
  hasLineup: boolean;
  /** The kinds already recorded for this fixture. */
  existingKinds: readonly ForecastKind[];
}

export type Due = { kind: ForecastKind } | { skip: string };

/**
 * The kind due for this fixture now, or why none is.
 *
 * Two rules do all the work. **Once each:** a kind already recorded is never
 * recomputed, because a version is a statement about the moment it was made and
 * a second one would either duplicate it or quietly contradict it. **Never
 * after kick-off:** the blueprint's versions are pre-match by definition; what
 * happens afterwards is the evaluation, not another forecast.
 *
 * `lineups_predicted` is deliberately never returned. Nothing we have supplies
 * *predicted* line-ups — only confirmed ones, and only from the detail source of
 * D-049 — so producing that kind automatically would mean labelling a confirmed
 * line-up as a predicted one, or computing a version from nothing new. It stays
 * available to an operator over HTTP, which is the honest place for a judgement
 * nobody's data can make.
 */
export function dueKind(state: FixtureState, now: Date): Due {
  if (state.status !== 'scheduled') {
    return {
      skip: `status is ${state.status}, and a pre-match version is only due before kick-off`,
    };
  }
  if (state.kickoffAt.getTime() <= now.getTime()) {
    return { skip: 'kick-off has passed' };
  }

  const has = (kind: ForecastKind): boolean => state.existingKinds.includes(kind);

  if (state.hasLineup && !has('lineups_confirmed')) return { kind: 'lineups_confirmed' };

  const daysAway = (state.kickoffAt.getTime() - now.getTime()) / MILLISECONDS_PER_DAY;
  if (daysAway > EARLY_WINDOW_DAYS) {
    return { skip: `kick-off is ${Math.floor(daysAway)} days away` };
  }
  if (!has('early')) return { kind: 'early' };

  return {
    skip: state.hasLineup
      ? 'every kind this data can produce has been recorded'
      : 'the early version is recorded and no line-up has arrived yet',
  };
}
