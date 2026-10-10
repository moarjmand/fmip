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
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

export interface FixtureState {
  fixtureId: string;
  kickoffAt: Date;
  status: string;
  /** Whether a line-up is stored for either side. */
  hasLineup: boolean;
  /** The kinds already recorded for this fixture. */
  existingKinds: readonly ForecastKind[];
  /**
   * The newest published version's model, kind and `unavailable` reason
   * (T-1373, D-191), when it was computed and the last day of results its fit
   * read (`inputs.fit_date`, null when the model did not answer; T-1377), or
   * null when the fixture has none.
   */
  newestPublished: {
    modelVersion: string;
    kind: ForecastKind;
    reason: string | null;
    computedAt: Date;
    fitDate: string | null;
  } | null;
  /**
   * The newest UTC day before today on which either side finished a match
   * with a stored full-time score in a competition the fit reads (the
   * fixture's division, or every match the cross-league fit reads), on or
   * after the day after the newest version's fit date; null when there is
   * none (T-1377). `YYYY-MM-DD`.
   */
  newestResultOn: string | null;
}

/**
 * The least time between two published forecasts of one fixture when the
 * second is a refresh (T-1377, D-195): at most one refresh a day per fixture.
 */
export const REFRESH_MIN_HOURS = 24;

/**
 * The model id the API stores when no model version answered: an outage, a
 * contract violation, an unmapped competition, or the model's own
 * `unavailable` (T-064). It names no published version.
 */
export const NO_MODEL_VERSION = 'none@0.0.0';

/** What a cup match's published version said before D-191 asked the model about it. */
const NEVER_ASKED = 'cross_competition';

/**
 * `replaces`: the model version whose newest forecast this one supersedes,
 * when it is due only because the published version changed (D-191).
 * `refreshes`: the fit date of the newest forecast, when this one is due only
 * because results its fit did not read have been stored since (D-195).
 */
export type Due = { kind: ForecastKind; replaces?: string; refreshes?: string } | { skip: string };

/** The UTC day of an instant, `YYYY-MM-DD`. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Whether the newest published forecast's fit has been overtaken (T-1377,
 * D-195): a fit made now would read a result it did not.
 *
 * The model fits on every result up to the day before the forecast is made
 * (`fit_date`, `apps/model/fmip_model/service/forecaster.py`), so a result is
 * missing from it when it was played after `fit_date`, and a fit made now
 * reads it when it was played before today (UTC). Pure, so the rule is
 * tested without a database; the query supplies `newestResultOn`.
 */
export function inputsMovedOn(state: FixtureState, now: Date): boolean {
  const fitDate = state.newestPublished?.fitDate ?? null;
  const result = state.newestResultOn;
  if (fitDate === null || result === null) return false;
  return result > fitDate && result < utcDay(now);
}

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
 *
 * **A new published version** (T-1373, D-191) is the one exception to "once
 * each": when `publishedModel` -- the version the model service publishes
 * now, null when it cannot be asked -- differs from the model version of the
 * fixture's newest published forecast, that kind is due once more, so a
 * match inside the window shows the new version before kick-off rather than
 * the replaced one until its line-ups arrive. The old versions stay as they
 * are (rule 5). It is due once: afterwards the newest forecast is the new
 * version's, or `none@0.0.0` when the model could not answer, which names no
 * version and is never retried. The one `none@0.0.0` it does replace, once,
 * is `cross_competition`: a cup match the published version was never asked
 * about before D-191 put such matches to it; the answer to that question is
 * never `cross_competition` again, so it too is due once.
 *
 * **Newer results** (T-1377, D-195) are the other exception: when the newest
 * published forecast is the published version's own, available, and its fit
 * has been overtaken -- either side has since finished a match the fit reads,
 * played after its fit date and before today (`inputsMovedOn`) -- the newest
 * automatic kind is due once more, as a new row on the newer results. At most
 * one a day: nothing is refreshed until the newest version is
 * `REFRESH_MIN_HOURS` old. Never when the model service cannot be asked
 * (that would store an outage over an answer), never for an `unavailable`
 * newest version, and, like every kind, never after kick-off or outside the
 * window. A due line-up, an unwritten early version and a new published
 * version all come first.
 */
export function dueKind(state: FixtureState, now: Date, publishedModel: string | null = null): Due {
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

  const newest = state.newestPublished;
  if (
    publishedModel !== null &&
    newest !== null &&
    newest.modelVersion !== publishedModel &&
    (newest.modelVersion !== NO_MODEL_VERSION || newest.reason === NEVER_ASKED)
  ) {
    // `lineups_predicted` is an operator's judgement, never this function's.
    if (newest.kind === 'lineups_predicted') {
      return { skip: 'the newest version is an operator’s; the new model waits for the next kind' };
    }
    return { kind: newest.kind, replaces: newest.modelVersion };
  }

  if (
    publishedModel !== null &&
    newest !== null &&
    newest.modelVersion === publishedModel &&
    newest.reason === null &&
    newest.fitDate !== null &&
    inputsMovedOn(state, now)
  ) {
    const hours = (now.getTime() - newest.computedAt.getTime()) / MILLISECONDS_PER_HOUR;
    if (hours < REFRESH_MIN_HOURS) {
      return {
        skip: `newer results are stored, and the newest version is less than ${REFRESH_MIN_HOURS} hours old`,
      };
    }
    // The newest automatic statement, made again on the newer results: the
    // confirmed line-up's once there is one, the early one before.
    return {
      kind: has('lineups_confirmed') ? 'lineups_confirmed' : 'early',
      refreshes: newest.fitDate,
    };
  }

  return {
    skip: state.hasLineup
      ? 'every kind this data can produce has been recorded'
      : 'the early version is recorded and no line-up has arrived yet',
  };
}
