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
  /**
   * The newest published version's model, kind and `unavailable` reason
   * (T-1373, D-191), or null when the fixture has none.
   */
  newestPublished: { modelVersion: string; kind: ForecastKind; reason: string | null } | null;
}

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
 */
export type Due = { kind: ForecastKind; replaces?: string } | { skip: string };

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

  return {
    skip: state.hasLineup
      ? 'every kind this data can produce has been recorded'
      : 'the early version is recorded and no line-up has arrived yet',
  };
}
