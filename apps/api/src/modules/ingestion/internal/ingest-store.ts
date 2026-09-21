/**
 * The writers the ingestion jobs use (T-026). All the SQL lives here; the job
 * bodies in `ingestion-jobs.service.ts` decide what to fetch and what a run
 * means.
 *
 * Two rules shape every statement.
 *
 * **Idempotent by construction.** Every write is an upsert on the table's own
 * natural key, and every `DO UPDATE` carries a `WHERE ... IS DISTINCT FROM`, so
 * a row that has not changed is not written. The count each method returns is
 * therefore the number of rows that really changed, which is what makes "a
 * replay changes nothing" a measurable claim rather than a hope. It also keeps
 * the `fixture_change` trigger (T-032, D-034) quiet: re-polling an unchanged
 * match wakes no stream client.
 *
 * **Nothing is invented.** Competitions, seasons, teams, people and venues are
 * never created here. They are resolved through the entity resolver, and an
 * unknown provider id is queued for review (T-013) and the row it would have
 * filled is skipped and counted. The one entity ingestion may create is the
 * fixture itself, and only once its season and both its teams have resolved;
 * the new fixture's mapping is then linked, audited as `ingest:<job>`.
 */

import type { Pool, PoolClient } from 'pg';
import type {
  NormalisedFixture,
  NormalisedIncident,
  NormalisedLineup,
  NormalisedPeriod,
  NormalisedSideLineup,
  NormalisedStat,
  Provider,
  Side,
} from '@fmip/ingestion';
import { PERIOD_KINDS } from '@fmip/ingestion';
import type { EntityType } from './resolver';

/** One competition/season pair a job polls, already resolved to our ids. */
export interface PollTarget {
  competitionId: string;
  competitionExternalId: string;
  seasonId: string;
  seasonLabel: string;
  /** The season's own span, `YYYY-MM-DD`: what a backfill asks for (T-030). */
  seasonStart: string;
  seasonEnd: string;
}

/** What a write did: rows changed, and the provider ids that had no mapping. */
export interface WriteResult {
  changed: number;
  unresolved: string[];
  /** The season the fixture landed in, so the caller can recompute its coverage (T-027). */
  seasonId?: string;
}

export const NOTHING: WriteResult = { changed: 0, unresolved: [] };

function merge(...results: WriteResult[]): WriteResult {
  return {
    changed: results.reduce((sum, r) => sum + r.changed, 0),
    unresolved: results.flatMap((r) => r.unresolved),
  };
}

/** How the store asks for an internal id. Implemented by `EntityResolverService`. */
export interface RefResolver {
  resolve(
    ref: { provider: Provider; entityType: EntityType; externalId: string },
    payload?: unknown,
  ): Promise<{ kind: 'resolved'; internalId: string } | { kind: string }>;
  link(
    ref: { provider: Provider; entityType: EntityType; externalId: string },
    internalId: string,
    actor: string,
    note?: string | null,
  ): Promise<{ kind: string }>;
}

export class IngestStore {
  constructor(
    private readonly pool: Pool,
    private readonly resolver: RefResolver,
  ) {}

  /**
   * Which competition/season pairs this provider can be polled for: the
   * competitions it has a mapping for, on their current season. A competition
   * nobody has mapped is not polled — there would be nowhere to put the result.
   */
  async pollTargets(provider: Provider): Promise<PollTarget[]> {
    const { rows } = await this.pool.query<{
      competition_id: string;
      external_id: string;
      season_id: string;
      label: string;
      start_date: string;
      end_date: string;
    }>(
      `SELECT c.id AS competition_id, pm.external_id, s.id AS season_id, s.label,
              to_char(s.start_date, 'YYYY-MM-DD') AS start_date,
              to_char(s.end_date, 'YYYY-MM-DD') AS end_date
         FROM provider_mapping pm
         JOIN competition c ON c.id = pm.internal_id
         JOIN season s ON s.competition_id = c.id AND s.is_current
        WHERE pm.provider = $1 AND pm.entity_type = 'competition'
        ORDER BY c.name`,
      [provider],
    );
    return rows.map((row) => ({
      competitionId: row.competition_id,
      competitionExternalId: row.external_id,
      seasonId: row.season_id,
      seasonLabel: row.label,
      seasonStart: row.start_date,
      seasonEnd: row.end_date,
    }));
  }

  /**
   * The provider's ids for fixtures we already hold in a window around now, for
   * one competition. By competition rather than by season: a window a few hours
   * wide can straddle an edition boundary, and a detail job should follow the
   * match, not the label.
   */
  async fixtureExternalIds(
    provider: Provider,
    competitionId: string,
    fromIso: string,
    toIso: string,
  ): Promise<{ externalId: string; fixtureId: string; status: string }[]> {
    const { rows } = await this.pool.query<{
      external_id: string;
      fixture_id: string;
      status: string;
    }>(
      `SELECT pm.external_id, f.id AS fixture_id, f.status
         FROM fixture f
         JOIN season s ON s.id = f.season_id
         JOIN provider_mapping pm
           ON pm.internal_id = f.id AND pm.entity_type = 'fixture' AND pm.provider = $1
        WHERE s.competition_id = $2 AND f.kickoff_at >= $3 AND f.kickoff_at < $4
        ORDER BY f.kickoff_at`,
      [provider, competitionId, fromIso, toIso],
    );
    return rows.map((r) => ({
      externalId: r.external_id,
      fixtureId: r.fixture_id,
      status: r.status,
    }));
  }

  private async resolveId(
    provider: Provider,
    entityType: EntityType,
    externalId: string | null,
    payload: unknown = null,
  ): Promise<string | null> {
    if (externalId === null || externalId === '') return null;
    const outcome = await this.resolver.resolve({ provider, entityType, externalId }, payload);
    return outcome.kind === 'resolved' ? (outcome as { internalId: string }).internalId : null;
  }

  /**
   * The team a provider id names, or `null` if nobody has identified it. Used
   * by the standings check, which has to compare like with like: a provider's
   * spelling of a club is not a key (rule 1).
   */
  resolveTeam(
    provider: Provider,
    ref: { externalId: string; name: string },
  ): Promise<string | null> {
    return this.resolveId(provider, 'team', ref.externalId, ref);
  }

  /** The fixture's internal id if it is known, or `null`. */
  async findFixture(provider: Provider, externalId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ internal_id: string }>(
      `SELECT internal_id FROM provider_mapping
        WHERE provider = $1 AND entity_type = 'fixture' AND external_id = $2`,
      [provider, externalId],
    );
    return rows[0]?.internal_id ?? null;
  }

  /**
   * Writes one fixture and everything the fixture list carries: the two
   * participants and every score the provider supplied. Creates the fixture the
   * first time, updates only what changed afterwards.
   */
  async saveFixture(
    provider: Provider,
    target: PollTarget,
    fixture: NormalisedFixture,
    job: string,
  ): Promise<WriteResult> {
    const unresolved: string[] = [];
    const homeId = await this.resolveId(provider, 'team', fixture.home.externalId, fixture.home);
    const awayId = await this.resolveId(provider, 'team', fixture.away.externalId, fixture.away);
    if (homeId === null) unresolved.push(`team:${fixture.home.externalId}`);
    if (awayId === null) unresolved.push(`team:${fixture.away.externalId}`);
    if (homeId === null || awayId === null) return { changed: 0, unresolved };

    const venueId = await this.resolveId(
      provider,
      'venue',
      fixture.venue?.externalId ?? null,
      fixture.venue,
    );
    const refereeId = await this.resolveId(
      provider,
      'person',
      fixture.referee?.externalId ?? null,
      fixture.referee,
    );
    // The edition the provider says this match belongs to, not the one the poll
    // started from: a fixture list can straddle two seasons, and the label is
    // unique per competition by constraint.
    const seasonId = await this.seasonId(target, fixture.season.label);
    if (seasonId === null) {
      unresolved.push(`season:${target.competitionExternalId}/${fixture.season.label}`);
      return { changed: 0, unresolved };
    }
    const stageId = await this.stageId(seasonId, fixture.stage?.name ?? null);
    const minute = fixture.status === 'live' ? fixture.minute : null;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let fixtureId = await this.findFixture(provider, fixture.externalId);
      const created = fixtureId === null;
      let changed = 0;

      if (fixtureId === null) {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO fixture
             (season_id, stage_id, round, kickoff_at, status, minute, venue_id,
              is_neutral_venue, referee_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)
           RETURNING id`,
          [
            seasonId,
            stageId,
            fixture.round,
            fixture.kickoffAt,
            fixture.status,
            minute,
            venueId,
            refereeId,
          ],
        );
        fixtureId = rows[0]?.id ?? null;
        if (fixtureId === null) throw new Error('insert into fixture returned no id');
        changed += 1;
      } else {
        const { rowCount } = await client.query(
          `UPDATE fixture
              SET stage_id = $2, round = $3, kickoff_at = $4, status = $5, minute = $6,
                  venue_id = $7, referee_id = $8
            WHERE id = $1
              AND (stage_id, round, kickoff_at, status, minute, venue_id, referee_id)
                  IS DISTINCT FROM ($2, $3, $4::timestamptz, $5, $6::smallint, $7, $8)`,
          [
            fixtureId,
            stageId,
            fixture.round,
            fixture.kickoffAt,
            fixture.status,
            minute,
            venueId,
            refereeId,
          ],
        );
        changed += rowCount ?? 0;
      }

      changed += await this.upsertParticipant(client, fixtureId, homeId, 'home');
      changed += await this.upsertParticipant(client, fixtureId, awayId, 'away');
      changed += await this.upsertScores(client, fixtureId, fixture);

      await client.query('COMMIT');

      if (created) {
        await this.resolver.link(
          { provider, entityType: 'fixture', externalId: fixture.externalId },
          fixtureId,
          `ingest:${job}`,
          `created from ${provider} ${fixture.home.name} v ${fixture.away.name}`,
        );
      }
      return { changed, unresolved, seasonId };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertParticipant(
    client: PoolClient,
    fixtureId: string,
    teamId: string,
    side: Side,
  ): Promise<number> {
    const { rowCount } = await client.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, $3)
       ON CONFLICT (fixture_id, side) DO UPDATE SET team_id = EXCLUDED.team_id
        WHERE fixture_participant.team_id IS DISTINCT FROM EXCLUDED.team_id`,
      [fixtureId, teamId, side],
    );
    return rowCount ?? 0;
  }

  private async upsertScores(
    client: PoolClient,
    fixtureId: string,
    fixture: NormalisedFixture,
  ): Promise<number> {
    const kinds: [string, { home: number; away: number } | null][] = [
      ['current', fixture.scores.current],
      ['half_time', fixture.scores.halfTime],
      ['full_time', fixture.scores.fullTime],
      ['extra_time', fixture.scores.extraTime],
      ['penalties', fixture.scores.penalties],
      ['aggregate', fixture.scores.aggregate],
    ];
    let changed = 0;
    for (const [kind, score] of kinds) {
      if (score === null) continue;
      const { rowCount } = await client.query(
        `INSERT INTO fixture_score (fixture_id, kind, home, away)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (fixture_id, kind) DO UPDATE SET home = EXCLUDED.home, away = EXCLUDED.away
          WHERE (fixture_score.home, fixture_score.away)
                IS DISTINCT FROM (EXCLUDED.home, EXCLUDED.away)`,
        [fixtureId, kind, score.home, score.away],
      );
      changed += rowCount ?? 0;
    }
    return changed;
  }

  /** The competition's season with that label, or `null`. Seasons are never created here. */
  async seasonId(target: PollTarget, label: string): Promise<string | null> {
    if (label === target.seasonLabel) return target.seasonId;
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM season WHERE competition_id = $1 AND label = $2`,
      [target.competitionId, label],
    );
    return rows[0]?.id ?? null;
  }

  /** The season's stage with that name, or `null`. Stages are never created here. */
  private async stageId(seasonId: string, name: string | null): Promise<string | null> {
    if (name === null) return null;
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM stage WHERE season_id = $1 AND name = $2`,
      [seasonId, name],
    );
    return rows[0]?.id ?? null;
  }

  /** The periods of a fixture. `sequence` is the order of the kind, not the provider's. */
  async savePeriods(fixtureId: string, periods: NormalisedPeriod[]): Promise<WriteResult> {
    let changed = 0;
    for (const period of periods) {
      const sequence = PERIOD_KINDS.indexOf(period.kind) + 1;
      const { rowCount } = await this.pool.query(
        `INSERT INTO fixture_period (fixture_id, kind, sequence, started_at, ended_at, added_minutes)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (fixture_id, kind) DO UPDATE
            SET started_at = EXCLUDED.started_at,
                ended_at = EXCLUDED.ended_at,
                added_minutes = EXCLUDED.added_minutes
          WHERE (fixture_period.started_at, fixture_period.ended_at, fixture_period.added_minutes)
                IS DISTINCT FROM (EXCLUDED.started_at, EXCLUDED.ended_at, EXCLUDED.added_minutes)`,
        [fixtureId, period.kind, sequence, period.startedAt, period.endedAt, period.addedMinutes],
      );
      changed += rowCount ?? 0;
    }
    return { changed, unresolved: [] };
  }

  private async participantId(fixtureId: string, side: Side): Promise<string | null> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM fixture_participant WHERE fixture_id = $1 AND side = $2`,
      [fixtureId, side],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Incidents in provider order. A player we cannot resolve means the incident
   * cannot be shown honestly, so it is skipped and named, not written blank.
   */
  async saveIncidents(
    provider: Provider,
    fixtureId: string,
    incidents: NormalisedIncident[],
  ): Promise<WriteResult> {
    const unresolved: string[] = [];
    const participants = new Map<Side, string | null>([
      ['home', await this.participantId(fixtureId, 'home')],
      ['away', await this.participantId(fixtureId, 'away')],
    ]);
    let changed = 0;

    for (const incident of incidents) {
      const personId = await this.resolveId(
        provider,
        'person',
        incident.player?.externalId ?? null,
        incident.player,
      );
      const relatedId = await this.resolveId(
        provider,
        'person',
        incident.relatedPlayer?.externalId ?? null,
        incident.relatedPlayer,
      );
      if (incident.kind !== 'var' && personId === null) {
        unresolved.push(`person:${incident.player?.externalId ?? 'unnamed'}`);
        continue;
      }
      if (incident.kind === 'substitution' && relatedId === null) {
        unresolved.push(`person:${incident.relatedPlayer?.externalId ?? 'unnamed'}`);
        continue;
      }
      const participantId =
        incident.side === null ? null : (participants.get(incident.side) ?? null);

      const { rowCount } = await this.pool.query(
        `INSERT INTO incident
           (fixture_id, participant_id, person_id, related_person_id, kind, minute,
            added_time, sequence, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (fixture_id, sequence) DO UPDATE
            SET participant_id = EXCLUDED.participant_id,
                person_id = EXCLUDED.person_id,
                related_person_id = EXCLUDED.related_person_id,
                kind = EXCLUDED.kind,
                minute = EXCLUDED.minute,
                added_time = EXCLUDED.added_time,
                detail = EXCLUDED.detail
          WHERE (incident.participant_id, incident.person_id, incident.related_person_id,
                 incident.kind, incident.minute, incident.added_time, incident.detail)
                IS DISTINCT FROM
                (EXCLUDED.participant_id, EXCLUDED.person_id, EXCLUDED.related_person_id,
                 EXCLUDED.kind, EXCLUDED.minute, EXCLUDED.added_time, EXCLUDED.detail)`,
        [
          fixtureId,
          participantId,
          personId,
          relatedId,
          incident.kind,
          incident.minute,
          incident.addedTime,
          incident.sequence,
          incident.detail,
        ],
      );
      changed += rowCount ?? 0;
    }
    return { changed, unresolved };
  }

  /** Both sides of a lineup: the formation and coach on the participant, then the players. */
  async saveLineup(
    provider: Provider,
    fixtureId: string,
    lineup: NormalisedLineup,
  ): Promise<WriteResult> {
    const home = await this.saveSideLineup(provider, fixtureId, 'home', lineup.home);
    const away = await this.saveSideLineup(provider, fixtureId, 'away', lineup.away);
    return merge(home, away);
  }

  private async saveSideLineup(
    provider: Provider,
    fixtureId: string,
    side: Side,
    lineup: NormalisedSideLineup,
  ): Promise<WriteResult> {
    const participantId = await this.participantId(fixtureId, side);
    if (participantId === null) return NOTHING;

    const unresolved: string[] = [];
    const coachId = await this.resolveId(
      provider,
      'person',
      lineup.coach?.externalId ?? null,
      lineup.coach,
    );
    const { rowCount } = await this.pool.query(
      `UPDATE fixture_participant SET formation = $2, coach_id = $3
        WHERE id = $1 AND (formation, coach_id) IS DISTINCT FROM ($2, $3)`,
      [participantId, lineup.formation, coachId],
    );
    let changed = rowCount ?? 0;

    for (const player of lineup.players) {
      const personId = await this.resolveId(provider, 'person', player.externalId, player);
      if (personId === null) {
        unresolved.push(`person:${player.externalId}`);
        continue;
      }
      const { rowCount: written } = await this.pool.query(
        `INSERT INTO lineup (participant_id, person_id, role, shirt_number, position, is_captain)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (participant_id, person_id) DO UPDATE
            SET role = EXCLUDED.role,
                shirt_number = EXCLUDED.shirt_number,
                position = EXCLUDED.position,
                is_captain = EXCLUDED.is_captain
          WHERE (lineup.role, lineup.shirt_number, lineup.position, lineup.is_captain)
                IS DISTINCT FROM
                (EXCLUDED.role, EXCLUDED.shirt_number, EXCLUDED.position, EXCLUDED.is_captain)`,
        [
          participantId,
          personId,
          player.role,
          player.shirtNumber,
          player.position,
          player.isCaptain,
        ],
      );
      changed += written ?? 0;
    }
    return { changed, unresolved };
  }

  /** Team statistics. An absent metric stays absent; it is never stored as zero. */
  async saveStatistics(fixtureId: string, statistics: NormalisedStat[]): Promise<WriteResult> {
    const participants = new Map<Side, string | null>([
      ['home', await this.participantId(fixtureId, 'home')],
      ['away', await this.participantId(fixtureId, 'away')],
    ]);
    let changed = 0;
    for (const stat of statistics) {
      const participantId = participants.get(stat.side) ?? null;
      if (participantId === null) continue;
      const { rowCount } = await this.pool.query(
        `INSERT INTO fixture_stat (participant_id, metric, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (participant_id, metric) DO UPDATE SET value = EXCLUDED.value
          WHERE fixture_stat.value IS DISTINCT FROM EXCLUDED.value`,
        [participantId, stat.metric, stat.value],
      );
      changed += rowCount ?? 0;
    }
    return { changed, unresolved: [] };
  }
}
