import type { Pool } from 'pg';

/**
 * When a page's whole list of matches was last answered by the provider,
 * changed or not (T-1633, D-296), for the club page's and the competition
 * page's footers. D-189 gave the match header this check; the two list pages
 * still said only "Last data update", the newest change, so a club whose
 * matches had not changed since Saturday read as three days stale while the
 * provider had confirmed its list that morning.
 *
 * Per season, the newest whole-season ask across providers
 * (`season_fixture_poll.season_polled_at`, the daily sweep); a window ask
 * covers only some days, so it says nothing about the whole list. Over
 * several seasons, the oldest of those, so the time holds for every match
 * listed. Null when there are no seasons or any of them has never been
 * answered whole: then nothing is claimed.
 */
export async function listsCheckedAt(pool: Pool, seasonIds: string[]): Promise<string | null> {
  if (seasonIds.length === 0) return null;
  const { rows } = await pool.query<{ checked: Date | null }>(
    `SELECT CASE WHEN bool_and(s.polled IS NOT NULL) THEN min(s.polled) END AS checked
       FROM (SELECT (SELECT max(sp.season_polled_at) FROM season_fixture_poll sp
                      WHERE sp.season_id = ids.id) AS polled
               FROM unnest($1::uuid[]) AS ids (id)) s`,
    [[...new Set(seasonIds)]],
  );
  const checked = rows[0]?.checked ?? null;
  return checked === null ? null : checked.toISOString();
}
