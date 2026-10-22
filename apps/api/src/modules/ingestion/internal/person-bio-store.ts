import type { Pool } from 'pg';
import type { Provider } from '@fmip/ingestion';
import type {
  BioCountry,
  BioFields,
  BioPerson,
  PersonBioAnswer,
  PersonBioOutcome,
  PersonBiosStore,
} from './person-bios';

const FIELDS = ['date_of_birth', 'nationality_id', 'height_cm', 'preferred_foot'] as const;

/**
 * The bio pass's SQL (T-1428, D-220): who is owed an ask, the ask record, and
 * the one write, which fills only the fields still empty. Every field it
 * writes was empty, so `person_bio_fetch.written` is the whole change.
 */
export class PersonBioStore implements PersonBiosStore {
  constructor(private readonly pool: Pool) {}

  async peopleBiosDue(
    provider: Provider,
    askedBeforeIso: string,
    maxAttempts: number,
    limit: number,
  ): Promise<BioPerson[]> {
    if (limit <= 0) return [];
    const { rows } = await this.pool.query<{
      person_id: string;
      external_id: string;
      full_name: string;
      known_as: string | null;
      short_name: string | null;
    }>(
      `SELECT p.id AS person_id, m.external_id, p.full_name, p.known_as,
              n.previous_name AS short_name
         FROM person p
        CROSS JOIN LATERAL (
          SELECT min(pm.external_id) AS external_id FROM provider_mapping pm
           WHERE pm.internal_id = p.id AND pm.entity_type = 'person' AND pm.provider = $1) m
         LEFT JOIN person_bio_fetch f ON f.provider = $1 AND f.person_id = p.id
         LEFT JOIN person_name_fetch n ON n.provider = $1 AND n.person_id = p.id
                                      AND n.outcome = 'written'
        WHERE m.external_id IS NOT NULL
          AND (p.date_of_birth IS NULL OR p.nationality_id IS NULL OR p.height_cm IS NULL
               OR p.preferred_foot IS NULL)
          AND f.answered_at IS NULL
          AND (f.asked_at IS NULL OR f.asked_at < $2)
          AND (f.attempts IS NULL OR f.attempts < $3)
          -- A coach is never asked for a player's profile (D-230): by his id,
          -- which is all one adopted from a line-up has (T-1474), by a match
          -- he coached, or by a spell.
          AND m.external_id NOT LIKE 'coach:%'
          AND NOT EXISTS (SELECT 1 FROM fixture_participant fp WHERE fp.coach_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM coach_spell cs WHERE cs.person_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM fixture fx WHERE fx.referee_id = p.id)
        ORDER BY EXISTS (SELECT 1 FROM team_squad_member s WHERE s.person_id = p.id) DESC,
                 f.asked_at NULLS FIRST, p.id
        LIMIT $4`,
      [provider, askedBeforeIso, maxAttempts, limit],
    );
    return rows.map((r) => ({
      personId: r.person_id,
      externalId: r.external_id,
      names: [r.full_name, r.known_as, r.short_name].filter((n): n is string => n !== null),
    }));
  }

  async countries(): Promise<BioCountry[]> {
    const { rows } = await this.pool.query<BioCountry>(`SELECT id, code, name FROM country`);
    return rows;
  }

  async markPersonBioAsked(provider: Provider, personId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO person_bio_fetch (provider, person_id) VALUES ($1, $2)
       ON CONFLICT (provider, person_id) DO UPDATE
         SET asked_at = now(), attempts = person_bio_fetch.attempts + 1`,
      [provider, personId],
    );
  }

  async recordPersonBioAnswer(
    provider: Provider,
    personId: string,
    answer: PersonBioAnswer,
  ): Promise<PersonBioOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const written: BioFields = {};
      if (answer.outcome === 'readable') {
        const { rows } = await client.query<Record<(typeof FIELDS)[number], unknown>>(
          `SELECT date_of_birth, nationality_id, height_cm, preferred_foot
             FROM person WHERE id = $1 FOR UPDATE`,
          [personId],
        );
        const held = rows[0];
        if (held !== undefined) {
          for (const field of FIELDS) {
            const offered = answer.fields[field];
            if (offered !== undefined && held[field] === null) {
              (written as Record<string, unknown>)[field] = offered;
            }
          }
        }
        const columns = Object.keys(written);
        if (columns.length > 0) {
          // Each column is still empty: the row is locked, and the guard says so again.
          await client.query(
            `UPDATE person SET ${columns.map((c, i) => `${c} = $${i + 2}`).join(', ')}
              WHERE id = $1 AND ${columns.map((c) => `${c} IS NULL`).join(' AND ')}`,
            [personId, ...columns.map((c) => (written as Record<string, unknown>)[c])],
          );
        }
      }
      const outcome: PersonBioOutcome =
        answer.outcome !== 'readable'
          ? answer.outcome
          : Object.keys(written).length > 0
            ? 'written'
            : 'nothing_new';
      const detail =
        outcome === 'nothing_new' && Object.keys(answer.fields).length > 0
          ? `${answer.detail}; each was already held`
          : answer.detail;
      await client.query(
        `INSERT INTO person_bio_fetch
           (provider, person_id, answered_at, outcome, detail, written, unmatched_nationality)
         VALUES ($1, $2, now(), $3, $4, $5, $6)
         ON CONFLICT (provider, person_id) DO UPDATE
           SET asked_at = now(), attempts = person_bio_fetch.attempts + 1,
               answered_at = now(), outcome = EXCLUDED.outcome, detail = EXCLUDED.detail,
               written = EXCLUDED.written, unmatched_nationality = EXCLUDED.unmatched_nationality`,
        [
          provider,
          personId,
          outcome,
          detail,
          outcome === 'written' ? JSON.stringify(written) : null,
          answer.unmatchedNationality,
        ],
      );
      await client.query('COMMIT');
      return outcome;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
