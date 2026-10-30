import type { NormalisedAbsence, Provider } from '@fmip/ingestion';
import type { Pool } from 'pg';
import type {
  AbsenceHistoryFilter,
  AbsenceHistoryStorePort,
  AbsenceHistoryWrite,
  AbsenceSeason,
} from './absence-history';

/**
 * The SQL of the absence history (T-1650, D-306). The match, the club and
 * the player are found through `provider_mapping` only (rule 2), never by a
 * name (rule 1); a match or club we do not hold is not written, a player we
 * do not hold is written under the provider's id alone.
 */
export class AbsenceHistoryStore implements AbsenceHistoryStorePort {
  constructor(private readonly pool: Pool) {}

  /**
   * The past seasons of every competition mapped to the provider, from
   * `firstSeasonStart` on, the competitions kept out of the training store
   * included (D-304), each with what the provider last said of its absences.
   */
  async seasons(
    provider: Provider,
    filter: AbsenceHistoryFilter,
    firstSeasonStart: string,
  ): Promise<AbsenceSeason[]> {
    const { rows } = await this.pool.query<{
      competition_id: string;
      competition_name: string;
      external_id: string;
      season_id: string;
      label: string;
      absences: boolean | null;
    }>(
      `SELECT c.id AS competition_id, c.name AS competition_name, pm.external_id,
              s.id AS season_id, s.label, sfc.absences
         FROM provider_mapping pm
         JOIN competition c ON c.id = pm.internal_id
         JOIN season s ON s.competition_id = c.id
         LEFT JOIN season_feed_coverage sfc ON sfc.season_id = s.id AND sfc.provider = pm.provider
        WHERE pm.provider = $1 AND pm.entity_type = 'competition'
          AND NOT s.is_current
          AND s.start_date >= $2::date
          AND ($3::text IS NULL OR s.label = $3)
          AND ($4::text IS NULL OR pm.external_id = $4)
        ORDER BY c.name, s.start_date, pm.external_id`,
      [provider, firstSeasonStart, filter.seasonLabel, filter.competitionExternalId],
    );
    return rows.map((row) => ({
      competitionId: row.competition_id,
      competitionName: row.competition_name,
      competitionExternalId: row.external_id,
      seasonId: row.season_id,
      seasonLabel: row.label,
      absencesCovered: row.absences,
    }));
  }

  /**
   * One season's answer, upserted on (provider, match, provider's player) in
   * one statement. A row already written is rewritten with the answer's
   * words and time, and keeps its person id should the mapping be gone.
   */
  async write(
    provider: Provider,
    absences: NormalisedAbsence[],
    fetchedAt: string,
  ): Promise<AbsenceHistoryWrite> {
    const { rows } = await this.pool.query<{
      written: number;
      skipped: number;
      fixtures_unmapped: number;
      persons_unmapped: number;
    }>(
      `WITH incoming AS (
         SELECT * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
           AS t (fixture_ext, team_ext, person_ext, status, kind, reason)
       ), resolved AS (
         SELECT i.*, fx.id AS fixture_id, fx.season_id, tm.id AS team_id, pe.id AS person_id
           FROM incoming i
           LEFT JOIN provider_mapping fm
             ON fm.provider = $1 AND fm.entity_type = 'fixture' AND fm.external_id = i.fixture_ext
           LEFT JOIN fixture fx ON fx.id = fm.internal_id
           LEFT JOIN provider_mapping tmm
             ON tmm.provider = $1 AND tmm.entity_type = 'team' AND tmm.external_id = i.team_ext
           LEFT JOIN team tm ON tm.id = tmm.internal_id
           LEFT JOIN provider_mapping pem
             ON pem.provider = $1 AND pem.entity_type = 'person' AND pem.external_id = i.person_ext
           LEFT JOIN person pe ON pe.id = pem.internal_id
       ), written AS (
         INSERT INTO absence_history AS h
           (provider, fixture_id, season_id, team_id, person_id, provider_person_id,
            status, kind, reason, fetched_at)
         SELECT DISTINCT ON (r.fixture_id, r.person_ext)
                $1, r.fixture_id, r.season_id, r.team_id, r.person_id, r.person_ext,
                r.status, r.kind, r.reason, $8::timestamptz
           FROM resolved r
          WHERE r.fixture_id IS NOT NULL AND r.team_id IS NOT NULL
          ORDER BY r.fixture_id, r.person_ext, r.fixture_ext
         ON CONFLICT (provider, fixture_id, provider_person_id) DO UPDATE
           SET season_id = EXCLUDED.season_id,
               team_id = EXCLUDED.team_id,
               person_id = COALESCE(EXCLUDED.person_id, h.person_id),
               status = EXCLUDED.status,
               kind = EXCLUDED.kind,
               reason = EXCLUDED.reason,
               fetched_at = EXCLUDED.fetched_at
         RETURNING h.provider_person_id, h.person_id
       )
       SELECT (SELECT count(*) FROM written)::int AS written,
              (SELECT count(*) FROM resolved
                WHERE fixture_id IS NULL OR team_id IS NULL)::int AS skipped,
              (SELECT count(DISTINCT fixture_ext) FROM resolved
                WHERE fixture_id IS NULL)::int AS fixtures_unmapped,
              (SELECT count(DISTINCT provider_person_id) FROM written
                WHERE person_id IS NULL)::int AS persons_unmapped`,
      [
        provider,
        absences.map((a) => a.fixtureExternalId),
        absences.map((a) => a.team.externalId),
        absences.map((a) => a.player.externalId),
        absences.map((a) => a.status),
        absences.map((a) => a.kind),
        absences.map((a) => a.reason),
        fetchedAt,
      ],
    );
    const row = rows[0];
    return {
      written: row?.written ?? 0,
      skipped: row?.skipped ?? 0,
      fixturesUnmapped: row?.fixtures_unmapped ?? 0,
      personsUnmapped: row?.persons_unmapped ?? 0,
    };
  }

  /** Rows whose player has been mapped since they were written get our person id. */
  async relink(provider: Provider): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE absence_history h SET person_id = pe.id
         FROM provider_mapping pm
         JOIN person pe ON pe.id = pm.internal_id
        WHERE h.provider = $1 AND h.person_id IS NULL
          AND pm.provider = h.provider AND pm.entity_type = 'person'
          AND pm.external_id = h.provider_person_id`,
      [provider],
    );
    return rowCount ?? 0;
  }

  /**
   * Who ran the history and why (rule 10), before a request is spent: the
   * season and competition asked for, when narrowed, as the next value.
   */
  async audit(actorId: string, reason: string, filter: AbsenceHistoryFilter): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
       VALUES ($1, 'ingestion.absence_history', 'ingestion', 'absence_history', $2, NULL,
               NULLIF(jsonb_strip_nulls(jsonb_build_object('season', $3::text,
                                                           'competition', $4::text)), '{}'::jsonb))`,
      [actorId, reason, filter.seasonLabel, filter.competitionExternalId],
    );
  }
}
