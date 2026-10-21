import type { Pool, PoolClient } from 'pg';
import type { NormalisedCoach, Provider } from '@fmip/ingestion';
import type { CoachesKept, CoachesStore, TeamAsk, TeamAskReason } from './coaches';
import type { MediaSink, RefResolver } from './ingest-store';
import { type BioCountry, countryOf } from './person-bios';

/**
 * The `coaches` job's SQL (T-1439, D-230): which teams are owed an ask, the
 * ask records, the answer's writes, and putting back the coach references the
 * coach id space moved out. A coach is resolved through the resolver, so one
 * we do not hold is queued (D-079) and never created; a career spell is kept
 * only at a team `provider_mapping` knows (rule 1), the rest are counted.
 */
export class CoachStore implements CoachesStore {
  constructor(
    private readonly pool: Pool,
    private readonly resolver: RefResolver,
    private readonly media: MediaSink | null = null,
  ) {}

  async restoreSplitReferences(provider: Provider): Promise<number> {
    return this.inTransaction(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE fixture_participant fp
            SET coach_id = pm.internal_id
           FROM coach_reference_split s
           JOIN provider_mapping pm
             ON pm.provider = s.provider AND pm.entity_type = 'person'
            AND pm.external_id = s.coach_external_id
          WHERE s.provider = $1 AND s.restored_at IS NULL
            AND fp.id = s.participant_id AND fp.coach_id IS NULL`,
        [provider],
      );
      // A reference a re-asked line-up has already written is put back too.
      await client.query(
        `UPDATE coach_reference_split s
            SET restored_at = now()
           FROM provider_mapping pm
          WHERE s.provider = $1 AND s.restored_at IS NULL
            AND pm.provider = s.provider AND pm.entity_type = 'person'
            AND pm.external_id = s.coach_external_id`,
        [provider],
      );
      return rowCount ?? 0;
    });
  }

  async teamsDue(
    provider: Provider,
    at: { answeredBeforeIso: string; retryBeforeIso: string },
    maxFailures: number,
    limit: number,
  ): Promise<TeamAsk[]> {
    if (limit <= 0) return [];
    const { rows } = await this.pool.query<{
      team_id: string;
      external_id: string;
      reason: TeamAskReason;
    }>(
      `WITH playing AS (
         SELECT DISTINCT fp.team_id
           FROM season se
           JOIN fixture f ON f.season_id = se.id
           JOIN fixture_participant fp ON fp.fixture_id = f.id
          WHERE se.is_current),
       mapped AS (
         SELECT p.team_id, min(pm.external_id) AS external_id
           FROM playing p
           JOIN provider_mapping pm
             ON pm.internal_id = p.team_id AND pm.entity_type = 'team' AND pm.provider = $1
          GROUP BY 1),
       current_coach AS (
         SELECT DISTINCT ON (team_id) team_id, person_id
           FROM coach_spell
          WHERE source = $1 AND end_date IS NULL
          ORDER BY team_id, start_date DESC NULLS LAST, person_id),
       latest AS (
         SELECT DISTINCT ON (fp.team_id) fp.team_id, fp.coach_id, f.kickoff_at
           FROM fixture_participant fp
           JOIN fixture f ON f.id = fp.fixture_id
          WHERE fp.coach_id IS NOT NULL AND fp.team_id IN (SELECT team_id FROM mapped)
          ORDER BY fp.team_id, f.kickoff_at DESC),
       due AS (
         SELECT m.team_id, m.external_id, tf.answered_at,
                CASE
                  WHEN tf.team_id IS NULL THEN 'never_asked'
                  WHEN tf.failures = 0 AND l.kickoff_at > tf.answered_at
                       AND l.coach_id IS DISTINCT FROM c.person_id THEN 'lineup_change'
                  ELSE 'refresh'
                END AS reason,
                tf.team_id IS NULL
                  OR (tf.failures > 0 AND tf.failures < $4 AND tf.asked_at < $3)
                  OR (tf.failures = 0
                      AND (tf.answered_at < $2
                           OR (l.kickoff_at > tf.answered_at
                               AND l.coach_id IS DISTINCT FROM c.person_id))) AS owed
           FROM mapped m
           LEFT JOIN team_coach_fetch tf ON tf.source = $1 AND tf.team_id = m.team_id
           LEFT JOIN current_coach c ON c.team_id = m.team_id
           LEFT JOIN latest l ON l.team_id = m.team_id)
       SELECT team_id, external_id, reason
         FROM due
        WHERE owed
        ORDER BY CASE reason WHEN 'lineup_change' THEN 0 WHEN 'never_asked' THEN 1 ELSE 2 END,
                 answered_at NULLS FIRST, team_id
        LIMIT $5`,
      [provider, at.answeredBeforeIso, at.retryBeforeIso, maxFailures, limit],
    );
    return rows.map((r) => ({ teamId: r.team_id, externalId: r.external_id, reason: r.reason }));
  }

  async markTeamAsked(provider: Provider, ask: TeamAsk): Promise<void> {
    await this.pool.query(
      `INSERT INTO team_coach_fetch (source, team_id, asked_at, failures)
       VALUES ($1, $2, now(), 1)
       ON CONFLICT (source, team_id) DO UPDATE
         SET asked_at = now(), failures = team_coach_fetch.failures + 1`,
      [provider, ask.teamId],
    );
  }

  async saveTeamCoaches(
    provider: Provider,
    ask: TeamAsk,
    coaches: NormalisedCoach[],
    fetchedAt: string,
  ): Promise<CoachesKept> {
    const kept: CoachesKept = { coaches: 0, queued: 0, spells: 0, spellsUnmapped: 0 };
    const held: { personId: string; coach: NormalisedCoach }[] = [];
    for (const coach of coaches) {
      const { externalId, name, imageUrl } = coach.ref;
      // The review queue keeps what a reviewer needs to identify the coach;
      // an image address is not that, and stays out of it.
      const outcome = await this.resolver.resolve(
        { provider, entityType: 'person', externalId },
        { externalId, name },
      );
      if (outcome.kind === 'queued') kept.queued += 1;
      if (outcome.kind !== 'resolved') continue;
      const personId = (outcome as { internalId: string }).internalId;
      if (imageUrl !== undefined && this.media !== null) {
        await this.media.note(provider, 'person', personId, imageUrl);
      }
      held.push({ personId, coach });
    }

    const countries = held.length === 0 ? [] : await this.countries();
    return this.inTransaction(async (client) => {
      const teams = await teamIds(
        client,
        provider,
        held.flatMap(({ coach }) => coach.career.map((s) => s.team.externalId)),
      );
      for (const { personId, coach } of held) {
        await client.query(`DELETE FROM coach_spell WHERE source = $1 AND person_id = $2`, [
          provider,
          personId,
        ]);
        let spells = 0;
        for (const spell of coach.career) {
          const teamId = teams.get(spell.team.externalId);
          if (teamId === undefined) continue;
          await client.query(
            `INSERT INTO coach_spell (source, person_id, team_id, start_date, end_date, fetched_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [provider, personId, teamId, spell.start, spell.end, fetchedAt],
          );
          spells += 1;
        }
        const unmapped = coach.career.length - spells;
        await client.query(
          `INSERT INTO coach_fetch
             (source, person_id, fetched_at, spells_listed, spells_kept, spells_unmapped)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (source, person_id) DO UPDATE
             SET fetched_at = EXCLUDED.fetched_at, spells_listed = EXCLUDED.spells_listed,
                 spells_kept = EXCLUDED.spells_kept, spells_unmapped = EXCLUDED.spells_unmapped`,
          [provider, personId, fetchedAt, coach.career.length, spells, unmapped],
        );
        // Only what is empty is filled: a value a person or an earlier answer
        // wrote is never replaced by this one.
        const country = coach.nationality === null ? null : countryOf(coach.nationality, countries);
        await client.query(
          `UPDATE person
              SET date_of_birth = coalesce(date_of_birth, $2::date),
                  nationality_id = coalesce(nationality_id, $3::uuid)
            WHERE id = $1
              AND ((date_of_birth IS NULL AND $2::date IS NOT NULL)
                   OR (nationality_id IS NULL AND $3::uuid IS NOT NULL))`,
          [personId, coach.dateOfBirth, country?.id ?? null],
        );
        kept.coaches += 1;
        kept.spells += spells;
        kept.spellsUnmapped += unmapped;
      }
      await client.query(
        `INSERT INTO team_coach_fetch
           (source, team_id, asked_at, answered_at, failures,
            coaches_listed, coaches_kept, coaches_unmapped)
         VALUES ($1, $2, now(), now(), 0, $3, $4, $5)
         ON CONFLICT (source, team_id) DO UPDATE
           SET asked_at = now(), answered_at = now(), failures = 0,
               coaches_listed = EXCLUDED.coaches_listed, coaches_kept = EXCLUDED.coaches_kept,
               coaches_unmapped = EXCLUDED.coaches_unmapped`,
        [provider, ask.teamId, coaches.length, kept.coaches, kept.queued],
      );
      return kept;
    });
  }

  private async countries(): Promise<BioCountry[]> {
    const { rows } = await this.pool.query<BioCountry>(`SELECT id, code, name FROM country`);
    return rows;
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

/** Our team ids for the provider's, by `provider_mapping`; an id it does not know is absent. */
async function teamIds(
  client: PoolClient,
  provider: Provider,
  externalIds: string[],
): Promise<Map<string, string>> {
  if (externalIds.length === 0) return new Map();
  const { rows } = await client.query<{ external_id: string; internal_id: string }>(
    `SELECT external_id, internal_id FROM provider_mapping
      WHERE provider = $1 AND entity_type = 'team' AND external_id = ANY($2::text[])`,
    [provider, [...new Set(externalIds)]],
  );
  return new Map(rows.map((r) => [r.external_id, r.internal_id]));
}
