/**
 * When the provider's live list last answered while a match was live or
 * suspended (T-1394, D-209), as SQL over the fixture `id` expression given:
 * the newest completed `live` ingestion run, of a provider the fixture is
 * mapped to, that read at least one match. The live job asks for every match
 * we hold in its window in one request (`IngestionJobsService.live`), so a run
 * that read matches is an answer about each live one; a refused request reads
 * none and moves nothing. Null for any other status, and when no such run is
 * recorded.
 *
 * Only a run whose window still held the match counts (T-1577): the live job
 * asks about matches that kicked off up to `LIVE_ANSWER_WINDOW_MINUTES` ago,
 * so a run after that is no answer about this one. Without the bound a match
 * the provider left `live` at 90' or `suspended` read as answered, and so as
 * current, for as long as any other match was live.
 *
 * Read here rather than through the ingestion module because it is one more
 * column of a read the fixtures boundary already makes, as
 * `season_fixture_poll` is (T-1371); `ingest_run_recent_idx` (provider, job,
 * started_at) makes it one short backward walk per provider.
 */
/**
 * How long after kick-off the live job still asks about a match: the
 * ingestion boundary's `LIVE_WINDOW_AFTER_MINUTES`, which this read side does
 * not import (as `ABSENCES_ASKED_FROM_HOURS` in `covered.ts`).
 */
export const LIVE_ANSWER_WINDOW_MINUTES = 210;

export function liveAnsweredAtSql(fixtureId: string, status: string, kickoffAt: string): string {
  return `CASE WHEN ${status} IN ('live', 'suspended') THEN (
            SELECT max(run.finished_at)
              FROM provider_mapping pm
              CROSS JOIN LATERAL (
                SELECT r.finished_at FROM ingest_run r
                 WHERE r.provider = pm.provider AND r.job = 'live'
                   AND r.status IN ('succeeded', 'partial') AND r.items_seen > 0
                   AND r.started_at <= ${kickoffAt}
                                       + interval '${LIVE_ANSWER_WINDOW_MINUTES} minutes'
                 ORDER BY r.started_at DESC LIMIT 1) run
             WHERE pm.entity_type = 'fixture' AND pm.internal_id = ${fixtureId}) END`;
}
