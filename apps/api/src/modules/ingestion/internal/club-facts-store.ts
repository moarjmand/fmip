import type { Pool, PoolClient } from 'pg';
import type { NormalisedTeamFacts, NormalisedVenueFacts, Provider } from '@fmip/ingestion';
import type {
  ClubFactsSource,
  ImageNote,
  SeasonTeamsAsk,
  SeasonTeamsKept,
  VenueAsk,
} from './club-facts';

/** The provider's id for an internal id of `type`, the lowest when there are two. */
const providerId = (type: string, internal: string) => `
  CROSS JOIN LATERAL (
    SELECT min(pm.external_id) AS external_id FROM provider_mapping pm
     WHERE pm.internal_id = ${internal} AND pm.entity_type = '${type}' AND pm.provider = $1) m`;

/**
 * The club-and-ground pass's SQL (T-1438, D-229): who is owed an ask, the
 * ask records, and the writes. A team or a ground is written only when
 * `provider_mapping` knows its provider id (rule 1); the rest are counted.
 *
 * A fact the answer leaves out keeps the stored one: an answer that says
 * less is not a correction. A fact it gives replaces the stored one, so a
 * renovated ground's capacity or a club's move is picked up on refresh.
 * Every write compares first, so an unchanged row is not written.
 */
export class ClubFactsStore implements ClubFactsSource {
  constructor(private readonly pool: Pool) {}

  async seasonsDue(
    provider: Provider,
    at: { answeredBeforeIso: string; retryBeforeIso: string },
    maxFailures: number,
    limit: number,
  ): Promise<SeasonTeamsAsk[]> {
    if (limit <= 0) return [];
    const { rows } = await this.pool.query<{
      season_id: string;
      external_id: string;
      label: string;
    }>(
      `SELECT se.id AS season_id, m.external_id, se.label
         FROM season se
         ${providerId('competition', 'se.competition_id')}
         LEFT JOIN season_team_fetch tf ON tf.provider = $1 AND tf.season_id = se.id
        WHERE m.external_id IS NOT NULL
          AND se.label ~ '^[0-9]{4}'
          AND EXISTS (SELECT 1 FROM fixture f WHERE f.season_id = se.id)
          AND (tf.season_id IS NULL
               OR (tf.failures = 0 AND se.is_current AND tf.answered_at < $2)
               OR (tf.failures > 0 AND tf.failures < $4 AND tf.asked_at < $3))
        ORDER BY (tf.season_id IS NULL) DESC, se.is_current DESC, se.label DESC, se.id
        LIMIT $5`,
      [provider, at.answeredBeforeIso, at.retryBeforeIso, maxFailures, limit],
    );
    return rows.map((r) => ({
      seasonId: r.season_id,
      competitionExternalId: r.external_id,
      seasonLabel: r.label,
    }));
  }

  async venuesDue(
    provider: Provider,
    at: { answeredBeforeIso: string; retryBeforeIso: string },
    maxFailures: number,
    limit: number,
  ): Promise<VenueAsk[]> {
    if (limit <= 0) return [];
    const { rows } = await this.pool.query<{ venue_id: string; external_id: string }>(
      `WITH named AS (
         SELECT venue_id FROM fixture WHERE venue_id IS NOT NULL
         UNION
         SELECT home_venue_id FROM team WHERE home_venue_id IS NOT NULL)
       SELECT n.venue_id, m.external_id
         FROM named n
         ${providerId('venue', 'n.venue_id')}
         LEFT JOIN venue_detail_fetch vf ON vf.provider = $1 AND vf.venue_id = n.venue_id
        WHERE m.external_id IS NOT NULL
          AND (vf.venue_id IS NULL
               OR (vf.failures = 0 AND vf.answered_at < $2)
               OR (vf.failures > 0 AND vf.failures < $4 AND vf.asked_at < $3))
        ORDER BY (vf.venue_id IS NULL) DESC, vf.answered_at NULLS FIRST, n.venue_id
        LIMIT $5`,
      [provider, at.answeredBeforeIso, at.retryBeforeIso, maxFailures, limit],
    );
    return rows.map((r) => ({ venueId: r.venue_id, externalId: r.external_id }));
  }

  async markSeasonFailed(provider: Provider, seasonId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO season_team_fetch (provider, season_id, failures)
       VALUES ($1, $2, 1)
       ON CONFLICT (provider, season_id) DO UPDATE
         SET asked_at = now(), failures = season_team_fetch.failures + 1`,
      [provider, seasonId],
    );
  }

  async markVenueFailed(provider: Provider, venueId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO venue_detail_fetch (provider, venue_id, failures)
       VALUES ($1, $2, 1)
       ON CONFLICT (provider, venue_id) DO UPDATE
         SET asked_at = now(), failures = venue_detail_fetch.failures + 1`,
      [provider, venueId],
    );
  }

  async saveSeasonTeams(
    provider: Provider,
    seasonId: string,
    teams: NormalisedTeamFacts[],
  ): Promise<SeasonTeamsKept> {
    const kept: SeasonTeamsKept = {
      held: 0,
      clubsWritten: 0,
      venuesWritten: 0,
      unmappedVenues: 0,
      images: [],
    };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const held = await mappedTeams(
        client,
        provider,
        teams.map((t) => t.team.externalId),
      );
      const venues = await mappedVenues(
        client,
        provider,
        teams.flatMap((t) => (t.venue === null ? [] : [t.venue.externalId])),
      );
      for (const entry of teams) {
        const team = held.get(entry.team.externalId);
        if (team === undefined) continue;
        kept.held += 1;
        if (entry.team.imageUrl !== undefined) {
          kept.images.push({ entityType: 'team', entityId: team.id, url: entry.team.imageUrl });
        }
        // A national team's ground and founding year are its federation's.
        if (team.kind !== 'club' || entry.national === true) continue;
        const venueId = entry.venue === null ? undefined : venues.get(entry.venue.externalId);
        if (entry.venue !== null && venueId === undefined) kept.unmappedVenues += 1;
        const { rowCount } = await client.query(
          `UPDATE team
              SET founded_year = COALESCE($2::smallint, founded_year),
                  home_venue_id = COALESCE($3::uuid, home_venue_id)
            WHERE id = $1
              AND (founded_year, home_venue_id) IS DISTINCT FROM
                  (COALESCE($2::smallint, founded_year), COALESCE($3::uuid, home_venue_id))`,
          [team.id, entry.foundedYear, venueId ?? null],
        );
        kept.clubsWritten += rowCount ?? 0;
        if (entry.venue === null || venueId === undefined) continue;
        if (await writeVenue(client, venueId, entry.venue)) kept.venuesWritten += 1;
        await describedByTeam(client, provider, venueId);
        if (entry.venue.imageUrl !== null) {
          kept.images.push(venueImage(venueId, entry.venue.imageUrl));
        }
      }
      await client.query(
        `INSERT INTO season_team_fetch
           (provider, season_id, failures, answered_at, teams, held, unmapped_venues)
         VALUES ($1, $2, 0, now(), $3, $4, $5)
         ON CONFLICT (provider, season_id) DO UPDATE
           SET asked_at = now(), failures = 0, answered_at = now(),
               teams = EXCLUDED.teams, held = EXCLUDED.held,
               unmapped_venues = EXCLUDED.unmapped_venues`,
        [provider, seasonId, teams.length, kept.held, kept.unmappedVenues],
      );
      await client.query('COMMIT');
      return kept;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveVenue(
    provider: Provider,
    venueId: string,
    venue: NormalisedVenueFacts | null,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const written = venue === null ? false : await writeVenue(client, venueId, venue);
      await client.query(
        `INSERT INTO venue_detail_fetch (provider, venue_id, failures, answered_at, answered_by)
         VALUES ($1, $2, 0, now(), $3)
         ON CONFLICT (provider, venue_id) DO UPDATE
           SET asked_at = now(), failures = 0, answered_at = now(),
               answered_by = EXCLUDED.answered_by`,
        [provider, venueId, venue === null ? 'none' : 'venue'],
      );
      await client.query('COMMIT');
      return written;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function venueImage(venueId: string, url: string): ImageNote {
  return { entityType: 'venue', entityId: venueId, url };
}

/**
 * The ground's address, capacity and surface from the answer, each kept as
 * stored when the answer leaves it out; the city only where none is stored
 * (the catalogue's spelling stands). The name is the catalogue's and is
 * never touched. True when the row changed.
 */
async function writeVenue(
  client: PoolClient,
  venueId: string,
  venue: NormalisedVenueFacts,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE venue
        SET address = COALESCE($2::text, address),
            capacity = COALESCE($3::integer, capacity),
            surface = COALESCE($4::text, surface),
            city = COALESCE(city, $5::text)
      WHERE id = $1
        AND (address, capacity, surface, city) IS DISTINCT FROM
            (COALESCE($2::text, address), COALESCE($3::integer, capacity),
             COALESCE($4::text, surface), COALESCE(city, $5::text))`,
    [venueId, venue.address, venue.capacity, venue.surface, venue.city],
  );
  return (rowCount ?? 0) > 0;
}

/** A club's entry described the ground: it counts as answered, without moving `asked_at`. */
async function describedByTeam(
  client: PoolClient,
  provider: Provider,
  venueId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO venue_detail_fetch (provider, venue_id, failures, answered_at, answered_by)
     VALUES ($1, $2, 0, now(), 'team')
     ON CONFLICT (provider, venue_id) DO UPDATE
       SET failures = 0, answered_at = now(), answered_by = 'team'`,
    [provider, venueId],
  );
}

async function mappedVenues(
  client: PoolClient,
  provider: Provider,
  externalIds: string[],
): Promise<Map<string, string>> {
  if (externalIds.length === 0) return new Map();
  const { rows } = await client.query<{ external_id: string; internal_id: string }>(
    `SELECT external_id, internal_id FROM provider_mapping
      WHERE provider = $1 AND entity_type = 'venue' AND external_id = ANY($2::text[])`,
    [provider, externalIds],
  );
  return new Map(rows.map((r) => [r.external_id, r.internal_id]));
}

async function mappedTeams(
  client: PoolClient,
  provider: Provider,
  externalIds: string[],
): Promise<Map<string, { id: string; kind: 'club' | 'national' }>> {
  if (externalIds.length === 0) return new Map();
  const { rows } = await client.query<{
    external_id: string;
    id: string;
    kind: 'club' | 'national';
  }>(
    `SELECT pm.external_id, t.id, t.kind FROM provider_mapping pm
       JOIN team t ON t.id = pm.internal_id
      WHERE pm.provider = $1 AND pm.entity_type = 'team' AND pm.external_id = ANY($2::text[])`,
    [provider, externalIds],
  );
  return new Map(rows.map((r) => [r.external_id, { id: r.id, kind: r.kind }]));
}
