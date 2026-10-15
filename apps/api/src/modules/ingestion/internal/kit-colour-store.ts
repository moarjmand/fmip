import type { Provider } from '@fmip/ingestion';
import type { Pool } from 'pg';
import type { KitColoursStore, MatchOwedShirts } from './kit-colours';

/** The `kit_colours` job's SQL (T-1417, D-218): `fixture_kit_fetch` and the matches owed shirts. */
export class KitColourStore implements KitColoursStore {
  constructor(private readonly pool: Pool) {}

  async matchesOwedShirts(
    provider: Provider,
    askedBeforeIso: string,
    maxAttempts: number,
    limit: number,
  ): Promise<MatchOwedShirts[]> {
    const { rows } = await this.pool.query<{ fixture_id: string; external_id: string }>(
      `SELECT f.id AS fixture_id, pm.external_id
         FROM fixture f
         JOIN provider_mapping pm
           ON pm.internal_id = f.id AND pm.entity_type = 'fixture' AND pm.provider = $1
         LEFT JOIN fixture_kit_fetch k ON k.fixture_id = f.id
        WHERE f.status = 'finished'
          AND EXISTS (
            SELECT 1 FROM fixture_participant fp
             WHERE fp.fixture_id = f.id AND fp.kit_colour IS NULL
               AND EXISTS (SELECT 1 FROM lineup l WHERE l.participant_id = fp.id))
          AND (k.fixture_id IS NULL
               OR (k.answered_at IS NULL AND k.asked_at < $2 AND k.attempts < $3))
        ORDER BY f.kickoff_at DESC
        LIMIT $4`,
      [provider, askedBeforeIso, maxAttempts, limit],
    );
    return rows.map((r) => ({ fixtureId: r.fixture_id, externalId: r.external_id }));
  }

  async markShirtsAsked(provider: Provider, fixtureId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO fixture_kit_fetch (fixture_id, provider) VALUES ($1, $2)
       ON CONFLICT (fixture_id) DO UPDATE
         SET provider = EXCLUDED.provider, asked_at = now(),
             attempts = fixture_kit_fetch.attempts + 1`,
      [fixtureId, provider],
    );
  }

  async markShirtsAnswered(provider: Provider, fixtureId: string, shirts: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO fixture_kit_fetch (fixture_id, provider, answered_at, shirts)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (fixture_id) DO UPDATE
         SET provider = EXCLUDED.provider, asked_at = now(),
             attempts = fixture_kit_fetch.attempts + 1,
             answered_at = now(), shirts = EXCLUDED.shirts`,
      [fixtureId, provider, shirts],
    );
  }
}
