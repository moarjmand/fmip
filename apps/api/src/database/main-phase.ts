/**
 * The main competition of a season, as SQL (T-1394, D-209): what a reader
 * means by "the Champions League" -- the league or group stage and every
 * round after it -- and not the qualifying rounds before it. A cup's season
 * figures and leader boards count these matches only; a league season, whose
 * every match is its main competition, is unchanged.
 *
 * A fixture is in the main competition unless
 * - its stage is a `qualifying` stage, or
 * - its season has a league or group stage and it kicked off before that
 *   stage's first match. The qualifying rounds and their play-offs are
 *   often stored without a stage (no operator created one), so the date is
 *   what tells them apart; a knockout play-off after the league phase is in.
 *
 * Shared by the competition page (`catalog`) and the boards (`standings`),
 * so the two never count a different set of matches.
 */

/**
 * When a season's main competition starts: the first kick-off of its league
 * or group stage, or `-infinity` when it has none (every match counts).
 * `season` is an SQL expression for the season id, such as `$1`.
 */
export function mainPhaseStartSql(season: string): string {
  return `COALESCE(
            (SELECT min(mf.kickoff_at) FROM fixture mf
               JOIN stage ms ON ms.id = mf.stage_id
              WHERE mf.season_id = ${season} AND ms.kind IN ('league', 'group')),
            '-infinity'::timestamptz)`;
}

/**
 * Whether the fixture aliased `fixture` is in its season's main competition,
 * given `start`, an expression for `mainPhaseStartSql` of that season (read
 * once per query, not once per row).
 */
export function mainPhaseSql(fixture: string, start: string): string {
  return `(NOT EXISTS (SELECT 1 FROM stage qs
                        WHERE qs.id = ${fixture}.stage_id AND qs.kind = 'qualifying')
           AND ${fixture}.kickoff_at >= ${start})`;
}
