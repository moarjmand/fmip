import type { Pool } from 'pg';
import type { Provider } from '@fmip/ingestion';
import type {
  PersonNameAnswer,
  PersonNameOutcome,
  PersonNamesStore,
  ShortNamedPerson,
} from './person-names';

/**
 * A Latin initial (or several), then a Latin letter: the provider's short
 * form ("M. Salah", "A. S. Vaz dos Ramos", "E.Lako"). The coarse filter;
 * `parseShortForm` in `person-names.ts` is the exact one.
 */
export const SHORT_FORM_SQL = '^([A-Za-zÀ-ÖØ-öø-ɏ]\\.\\s*)+[A-Za-zÀ-ÖØ-öø-ɏ]';

/**
 * The `people_names` job's SQL (T-1398, D-213): who is owed an ask, the ask
 * record, and the one write of a full name.
 *
 * A name a person chose is never overwritten. No path writes `person.full_name`
 * by hand today -- the catalogue tool inserts it once, from the feed, and
 * audits that as `catalog.person_added` with the name it used (D-079) -- so
 * the provenance is the audit log: a person with any other audited action, or
 * whose adoption recorded a different name than the one stored now, or with a
 * `known_as` set, is left out. The write itself is a compare-and-set on the
 * name the job read.
 */
export class PersonNameStore implements PersonNamesStore {
  constructor(private readonly pool: Pool) {}

  async peopleNamesDue(
    provider: Provider,
    askedBeforeIso: string,
    maxAttempts: number,
    limit: number,
  ): Promise<ShortNamedPerson[]> {
    if (limit <= 0) return [];
    const { rows } = await this.pool.query<{
      person_id: string;
      external_id: string;
      full_name: string;
    }>(
      `SELECT p.id AS person_id, m.external_id, p.full_name
         FROM person p
        CROSS JOIN LATERAL (
          SELECT min(pm.external_id) AS external_id FROM provider_mapping pm
           WHERE pm.internal_id = p.id AND pm.entity_type = 'person' AND pm.provider = $1) m
         LEFT JOIN person_name_fetch f ON f.provider = $1 AND f.person_id = p.id
        WHERE m.external_id IS NOT NULL
          AND p.full_name ~ $5
          AND p.known_as IS NULL
          AND f.answered_at IS NULL
          AND (f.asked_at IS NULL OR f.asked_at < $2)
          AND (f.attempts IS NULL OR f.attempts < $3)
          -- A coach is not asked for a player's profile: his number is in the
          -- provider's coach id space (T-1439, D-230), and the same number is
          -- another man's player profile.
          -- Known as a coach by the id itself (T-1473): one adopted from a
          -- line-up has neither a match nor a spell recorded yet.
          AND m.external_id NOT LIKE 'coach:%'
          AND NOT EXISTS (SELECT 1 FROM fixture_participant fp WHERE fp.coach_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM coach_spell cs WHERE cs.person_id = p.id)
          AND NOT EXISTS (
            SELECT 1 FROM audit_log a
             WHERE a.target_type = 'person' AND a.target_id = p.id::text
               AND (a.action <> 'catalog.person_added'
                    OR a.next->>'name' IS DISTINCT FROM p.full_name))
        ORDER BY f.asked_at NULLS FIRST, p.id
        LIMIT $4`,
      [provider, askedBeforeIso, maxAttempts, limit, SHORT_FORM_SQL],
    );
    return rows.map((r) => ({
      personId: r.person_id,
      externalId: r.external_id,
      storedName: r.full_name,
    }));
  }

  async markPersonNameAsked(provider: Provider, personId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO person_name_fetch (provider, person_id) VALUES ($1, $2)
       ON CONFLICT (provider, person_id) DO UPDATE
         SET asked_at = now(), attempts = person_name_fetch.attempts + 1`,
      [provider, personId],
    );
  }

  async recordPersonNameAnswer(
    provider: Provider,
    person: ShortNamedPerson,
    answer: PersonNameAnswer,
  ): Promise<PersonNameOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let outcome = answer.outcome;
      let detail = answer.detail;
      let written: string | null = null;
      if (outcome === 'written' && answer.fullName !== undefined) {
        const changed = await client.query(
          `UPDATE person SET full_name = $3
            WHERE id = $1 AND full_name = $2 AND known_as IS NULL`,
          [person.personId, person.storedName, answer.fullName],
        );
        if (changed.rowCount === 1) {
          written = answer.fullName;
          if (answer.alias !== undefined) {
            // A universal alias: search still finds "M. Salah" (D-039). The
            // unique index is on the folded form, so a second is a no-op.
            await client.query(
              `INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
               VALUES ('person', $1, $2, NULL, 'abbreviation', $3)
               ON CONFLICT DO NOTHING`,
              [person.personId, answer.alias, provider],
            );
          }
        } else {
          outcome = 'name_kept';
          detail = 'the stored name changed after it was read';
        }
      }
      await client.query(
        `INSERT INTO person_name_fetch
           (provider, person_id, answered_at, outcome, detail, previous_name, written_name, profile_name)
         VALUES ($1, $2, now(), $3, $4, $5, $6, $7)
         ON CONFLICT (provider, person_id) DO UPDATE
           SET asked_at = now(), attempts = person_name_fetch.attempts + 1,
               answered_at = now(), outcome = EXCLUDED.outcome, detail = EXCLUDED.detail,
               previous_name = EXCLUDED.previous_name, written_name = EXCLUDED.written_name,
               profile_name = EXCLUDED.profile_name`,
        [
          provider,
          person.personId,
          outcome,
          detail,
          written === null ? null : person.storedName,
          written,
          answer.profileName,
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
