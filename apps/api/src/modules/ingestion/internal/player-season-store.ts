import type { Pool, PoolClient } from 'pg';
import type { NormalisedCareerEntry, NormalisedPlayerSeasonLine, Provider } from '@fmip/ingestion';
import type { CareerAsk, Kept, PlayerSeasonsStore, SeasonAsk } from './player-seasons';

/**
 * The players the job may ask about: each person named in a line-up of a
 * finished match of a current season that kicked off before `$2`, with the
 * year that season starts in and the latest such kick-off. A label that does
 * not start with a year ("2026/27", "2026") names no season the provider can
 * be asked for, so it is left out.
 */
const PLAYED = `
  SELECT l.person_id, substring(se.label FROM '^[0-9]{4}')::int AS season_year,
         max(f.kickoff_at) AS last_kickoff
    FROM season se
    JOIN fixture f ON f.season_id = se.id
    JOIN fixture_participant fp ON fp.fixture_id = f.id
    JOIN lineup l ON l.participant_id = fp.id
   WHERE se.is_current AND se.label ~ '^[0-9]{4}'
     AND f.status = 'finished' AND f.kickoff_at < $2
   GROUP BY 1, 2`;

/** The provider's id for the person, the lowest when there are two. */
const PERSON_ID = `
  CROSS JOIN LATERAL (
    SELECT min(pm.external_id) AS external_id FROM provider_mapping pm
     WHERE pm.internal_id = p.person_id AND pm.entity_type = 'person' AND pm.provider = $1) m`;

/**
 * The `player_seasons` job's SQL (T-1431, D-223): who is owed an ask, the ask
 * records, and the two writes. A competition or team is kept only when
 * `provider_mapping` knows its provider id (rule 1); the rest are counted.
 */
export class PlayerSeasonStore implements PlayerSeasonsStore {
  constructor(private readonly pool: Pool) {}

  async seasonsDue(
    provider: Provider,
    at: { playedBeforeIso: string; retryBeforeIso: string },
    maxFailures: number,
    limit: number,
  ): Promise<SeasonAsk[]> {
    if (limit <= 0) return [];
    const { rows } = await this.pool.query<{
      person_id: string;
      external_id: string;
      season_year: number;
    }>(
      `WITH played AS (${PLAYED})
       SELECT p.person_id, m.external_id, p.season_year
         FROM played p
         ${PERSON_ID}
         LEFT JOIN player_season_fetch sf
           ON sf.provider = $1 AND sf.person_id = p.person_id AND sf.season_year = p.season_year
        WHERE m.external_id IS NOT NULL
          AND p.season_year BETWEEN 1870 AND 2100
          AND (sf.person_id IS NULL
               OR (p.last_kickoff > coalesce(sf.answered_at, '-infinity'::timestamptz)
                   AND sf.failures < $4
                   AND (sf.failures = 0 OR sf.asked_at < $3)))
        ORDER BY p.last_kickoff DESC, p.person_id
        LIMIT $5`,
      [provider, at.playedBeforeIso, at.retryBeforeIso, maxFailures, limit],
    );
    return rows.map((r) => ({
      personId: r.person_id,
      externalId: r.external_id,
      seasonYear: r.season_year,
    }));
  }

  async careersDue(
    provider: Provider,
    at: { playedBeforeIso: string; retryBeforeIso: string; answeredBeforeIso: string },
    maxFailures: number,
    limit: number,
  ): Promise<CareerAsk[]> {
    if (limit <= 0) return [];
    const { rows } = await this.pool.query<{ person_id: string; external_id: string }>(
      `WITH played AS (
         SELECT person_id, max(last_kickoff) AS last_kickoff FROM (${PLAYED}) x GROUP BY 1)
       SELECT p.person_id, m.external_id
         FROM played p
         ${PERSON_ID}
         LEFT JOIN player_career_fetch cf ON cf.provider = $1 AND cf.person_id = p.person_id
        WHERE m.external_id IS NOT NULL
          AND (cf.person_id IS NULL
               OR (cf.failures = 0 AND cf.answered_at < $5)
               OR (cf.failures > 0 AND cf.failures < $4 AND cf.asked_at < $3))
        ORDER BY (cf.person_id IS NULL) DESC, p.last_kickoff DESC, p.person_id
        LIMIT $6`,
      [provider, at.playedBeforeIso, at.retryBeforeIso, maxFailures, at.answeredBeforeIso, limit],
    );
    return rows.map((r) => ({ personId: r.person_id, externalId: r.external_id }));
  }

  async markSeasonAsked(provider: Provider, ask: SeasonAsk): Promise<void> {
    await this.pool.query(
      `INSERT INTO player_season_fetch (provider, person_id, season_year, failures)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (provider, person_id, season_year) DO UPDATE
         SET asked_at = now(), failures = player_season_fetch.failures + 1`,
      [provider, ask.personId, ask.seasonYear],
    );
  }

  async markCareerAsked(provider: Provider, ask: CareerAsk): Promise<void> {
    await this.pool.query(
      `INSERT INTO player_career_fetch (provider, person_id, failures)
       VALUES ($1, $2, 1)
       ON CONFLICT (provider, person_id) DO UPDATE
         SET asked_at = now(), failures = player_career_fetch.failures + 1`,
      [provider, ask.personId],
    );
  }

  async saveSeason(
    provider: Provider,
    ask: SeasonAsk,
    lines: NormalisedPlayerSeasonLine[],
    fetchedAt: string,
  ): Promise<Kept> {
    return this.inTransaction(async (client) => {
      const competitions = await internalIds(
        client,
        provider,
        'competition',
        lines.map((l) => l.competition.externalId),
      );
      const teams = await internalIds(
        client,
        provider,
        'team',
        lines.map((l) => l.team.externalId),
      );
      await client.query(
        `DELETE FROM player_season_stat WHERE source = $1 AND person_id = $2 AND season_year = $3`,
        [provider, ask.personId, ask.seasonYear],
      );
      let unmapped = 0;
      for (const line of lines) {
        const competitionId = competitions.get(line.competition.externalId);
        const teamId = teams.get(line.team.externalId);
        if (
          competitionId === undefined ||
          teamId === undefined ||
          line.seasonYear !== ask.seasonYear
        ) {
          unmapped += 1;
          continue;
        }
        await client.query(
          `INSERT INTO player_season_stat
             (source, person_id, season_year, competition_id, team_id, appearances, starts, minutes,
              goals, assists, yellow_cards, second_yellow_cards, red_cards, saves, goals_conceded,
              rating, fetched_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           ON CONFLICT DO NOTHING`,
          [
            provider,
            ask.personId,
            ask.seasonYear,
            competitionId,
            teamId,
            line.appearances,
            line.starts,
            line.minutes,
            line.goals,
            line.assists,
            line.yellowCards,
            line.secondYellowCards,
            line.redCards,
            line.saves,
            line.goalsConceded,
            line.rating,
            fetchedAt,
          ],
        );
      }
      const kept = lines.length - unmapped;
      await client.query(
        `INSERT INTO player_season_fetch
           (provider, person_id, season_year, asked_at, failures, answered_at, lines, kept, unmapped)
         VALUES ($1, $2, $3, now(), 0, now(), $4, $5, $6)
         ON CONFLICT (provider, person_id, season_year) DO UPDATE
           SET asked_at = now(), failures = 0, answered_at = now(),
               lines = EXCLUDED.lines, kept = EXCLUDED.kept, unmapped = EXCLUDED.unmapped`,
        [provider, ask.personId, ask.seasonYear, lines.length, kept, unmapped],
      );
      return { kept, unmapped };
    });
  }

  async saveCareer(
    provider: Provider,
    ask: CareerAsk,
    entries: NormalisedCareerEntry[],
    fetchedAt: string,
  ): Promise<Kept> {
    return this.inTransaction(async (client) => {
      const teams = await internalIds(
        client,
        provider,
        'team',
        entries.map((e) => e.team.externalId),
      );
      await client.query(`DELETE FROM player_career_season WHERE source = $1 AND person_id = $2`, [
        provider,
        ask.personId,
      ]);
      let unmapped = 0;
      for (const entry of entries) {
        const teamId = teams.get(entry.team.externalId);
        if (teamId === undefined) {
          unmapped += 1;
          continue;
        }
        await client.query(
          `INSERT INTO player_career_season (source, person_id, team_id, season_year, fetched_at)
           SELECT $1, $2, $3, y, $5 FROM unnest($4::smallint[]) AS y
           ON CONFLICT DO NOTHING`,
          [provider, ask.personId, teamId, entry.seasonYears, fetchedAt],
        );
      }
      const kept = entries.length - unmapped;
      await client.query(
        `INSERT INTO player_career_fetch
           (provider, person_id, asked_at, failures, answered_at, teams, kept, unmapped)
         VALUES ($1, $2, now(), 0, now(), $3, $4, $5)
         ON CONFLICT (provider, person_id) DO UPDATE
           SET asked_at = now(), failures = 0, answered_at = now(),
               teams = EXCLUDED.teams, kept = EXCLUDED.kept, unmapped = EXCLUDED.unmapped`,
        [provider, ask.personId, entries.length, kept, unmapped],
      );
      return { kept, unmapped };
    });
  }

  private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

/** Our ids for the provider's, by `provider_mapping`; an id it does not know is absent. */
async function internalIds(
  client: PoolClient,
  provider: Provider,
  entityType: 'competition' | 'team',
  externalIds: string[],
): Promise<Map<string, string>> {
  if (externalIds.length === 0) return new Map();
  const { rows } = await client.query<{ external_id: string; internal_id: string }>(
    `SELECT external_id, internal_id FROM provider_mapping
      WHERE provider = $1 AND entity_type = $2 AND external_id = ANY($3::text[])`,
    [provider, entityType, [...new Set(externalIds)]],
  );
  return new Map(rows.map((r) => [r.external_id, r.internal_id]));
}
