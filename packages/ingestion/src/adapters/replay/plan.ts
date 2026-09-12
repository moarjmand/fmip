/**
 * What the committed recordings actually contain.
 *
 * A recording answers one URL, so a replay job has to ask for exactly what was
 * recorded. Keeping that here, next to the recordings, means the caller in
 * `apps/api` does not carry a copy of the provider's competition ids or season
 * labels — re-record against a different weekend and this file changes, not the
 * jobs.
 *
 * The set is the 2023/24 Premier League opening weekend, the newest season the
 * free plan serves (`docs/05-data-providers.md`).
 */

import type { FixtureQuery } from '../_contract';

export const REPLAY_QUERY: FixtureQuery = {
  competitionExternalId: '39',
  seasonLabel: '2023/24',
  from: '2023-08-11',
  to: '2023-08-14',
};

/** The one fixture whose line-up and detail were recorded: Burnley v Manchester City. */
export const REPLAY_FIXTURE = '1035037';
