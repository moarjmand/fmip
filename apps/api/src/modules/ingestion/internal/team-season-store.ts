import type { Pool } from 'pg';
import type { NormalisedTeamSeasonStats, Provider } from '@fmip/ingestion';
import type { TeamSeasonAsk, TeamSeasonsStore } from './team-seasons';

/** The provider's id for an entity of ours, the lowest when there are two. */
const mapped = (type: 'team' | 'competition', ourId: string) => `
  CROSS JOIN LATERAL (
    SELECT min(pm.external_id) AS external_id FROM provider_mapping pm
     WHERE pm.internal_id = ${ourId} AND pm.entity_type = '${type}' AND pm.provider = $1)`;

/**
 * The `team_seasons` job's SQL (T-1437, D-228): which teams and seasons are
 * owed an ask, the ask records, and the write. Only a team and a competition
 * `provider_mapping` knows are asked about (rule 1), so every answer is kept.
 */
export class TeamSeasonStore implements TeamSeasonsStore {
  constructor(private readonly pool: Pool) {}

  async due(
    provider: Provider,
    at: { settledBeforeIso: string; refreshBeforeIso: string; retryBeforeIso: string },
    maxFailures: number,
    limit: number,
  ): Promise<TeamSeasonAsk[]> {
    if (limit <= 0) return [];
    const { rows } = await this.pool.query<{
      team_id: string;
      season_id: string;
      label: string;
      team_external_id: string;
      competition_external_id: string;
    }>(
      `WITH played AS (
         SELECT fp.team_id, f.season_id, max(f.kickoff_at) AS last_kickoff
           FROM fixture f
           JOIN fixture_participant fp ON fp.fixture_id = f.id
          WHERE f.status = 'finished' AND f.kickoff_at < $2
          GROUP BY 1, 2)
       SELECT p.team_id, p.season_id, se.label,
              tm.external_id AS team_external_id, cm.external_id AS competition_external_id
         FROM played p
         JOIN season se ON se.id = p.season_id
         ${mapped('team', 'p.team_id')} tm
         ${mapped('competition', 'se.competition_id')} cm
         LEFT JOIN team_season_fetch sf
           ON sf.provider = $1 AND sf.team_id = p.team_id AND sf.season_id = p.season_id
        WHERE tm.external_id IS NOT NULL AND cm.external_id IS NOT NULL
          AND se.label ~ '^[0-9]{4}'
          AND (sf.team_id IS NULL
               OR (sf.failures > 0 AND sf.failures < $5 AND sf.asked_at < $4)
               OR (sf.failures = 0 AND se.is_current
                   AND (sf.answered_at < $3 OR p.last_kickoff > sf.answered_at)))
        ORDER BY se.is_current DESC, (sf.team_id IS NULL) DESC, se.start_date DESC,
                 p.last_kickoff DESC, p.team_id
        LIMIT $6`,
      [provider, at.settledBeforeIso, at.refreshBeforeIso, at.retryBeforeIso, maxFailures, limit],
    );
    return rows.map((r) => ({
      teamId: r.team_id,
      seasonId: r.season_id,
      teamExternalId: r.team_external_id,
      competitionExternalId: r.competition_external_id,
      seasonLabel: r.label,
    }));
  }

  async markAsked(provider: Provider, ask: TeamSeasonAsk): Promise<void> {
    await this.pool.query(
      `INSERT INTO team_season_fetch (provider, team_id, season_id, failures)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (provider, team_id, season_id) DO UPDATE
         SET asked_at = now(), failures = team_season_fetch.failures + 1`,
      [provider, ask.teamId, ask.seasonId],
    );
  }

  async save(
    provider: Provider,
    ask: TeamSeasonAsk,
    stats: NormalisedTeamSeasonStats | null,
    fetchedAt: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM team_season_stat WHERE source = $1 AND team_id = $2 AND season_id = $3`,
        [provider, ask.teamId, ask.seasonId],
      );
      if (stats !== null) {
        const s = stats;
        await client.query(
          `INSERT INTO team_season_stat
             (source, team_id, season_id, played_home, played_away, wins_home, wins_away,
              draws_home, draws_away, losses_home, losses_away, goals_for_home, goals_for_away,
              goals_against_home, goals_against_away, clean_sheets_home, clean_sheets_away,
              failed_to_score_home, failed_to_score_away, form, goals_for_by_minute,
              goals_against_by_minute, bands_withheld, penalties_scored, penalties_missed,
              biggest, formations, fetched_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                   $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)`,
          [
            provider,
            ask.teamId,
            ask.seasonId,
            s.played.home,
            s.played.away,
            s.wins.home,
            s.wins.away,
            s.draws.home,
            s.draws.away,
            s.losses.home,
            s.losses.away,
            s.goalsFor.home,
            s.goalsFor.away,
            s.goalsAgainst.home,
            s.goalsAgainst.away,
            s.cleanSheets.home,
            s.cleanSheets.away,
            s.failedToScore.home,
            s.failedToScore.away,
            s.form,
            s.goalsForByMinute === null ? null : JSON.stringify(s.goalsForByMinute),
            s.goalsAgainstByMinute === null ? null : JSON.stringify(s.goalsAgainstByMinute),
            s.bandsWithheld,
            s.penaltiesScored,
            s.penaltiesMissed,
            JSON.stringify({ win: s.biggestWin, defeat: s.biggestDefeat, run: s.longestRun }),
            JSON.stringify(s.formations),
            fetchedAt,
          ],
        );
      }
      await client.query(
        `INSERT INTO team_season_fetch
           (provider, team_id, season_id, asked_at, failures, answered_at, supplied)
         VALUES ($1, $2, $3, now(), 0, now(), $4)
         ON CONFLICT (provider, team_id, season_id) DO UPDATE
           SET asked_at = now(), failures = 0, answered_at = now(), supplied = EXCLUDED.supplied`,
        [provider, ask.teamId, ask.seasonId, stats !== null],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
