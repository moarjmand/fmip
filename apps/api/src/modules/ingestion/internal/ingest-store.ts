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
 * filled is skipped and counted. An id a reviewer has set aside as not ours
 * to model (`ignored`, T-1338) is skipped too, but is no gap: it is not
 * counted, and a fixture with such a side is not written. The one entity ingestion may create is the
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
  NormalisedAbsence,
  NormalisedPlayerStat,
  NormalisedStat,
  Provider,
  Side,
} from '@fmip/ingestion';
import { PERIOD_KINDS } from '@fmip/ingestion';
import type { EntityType } from './resolver';
import type { SquadStore, SquadTeam } from './squad-sweep';

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
  /** The fixture written, for a caller with more to write about it (T-830). */
  fixtureId?: string;
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

/**
 * Where the store hands the provider's image address for an entity it has
 * resolved (T-1320, D-176). Implemented by `MediaService`; never throws.
 */
export interface MediaSink {
  note(
    provider: Provider,
    entityType: 'team' | 'competition' | 'person',
    entityId: string,
    sourceUrl: string,
  ): Promise<void>;
}

/** A ref without its image address (T-1320); anything else as it came. */
function withoutImage(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || !('imageUrl' in payload)) return payload;
  const { imageUrl: _image, ...rest } = payload as Record<string, unknown>;
  return rest;
}

/**
 * A team's ref as the review queue keeps it, with the competition whose
 * fixtures or table it was seen in (T-1332, D-179): `catalog.mjs
 * --adopt-teams` reads that competition's scope to tell a national team from
 * a club, since the provider's team ref does not say which it is.
 */
export function sighting<T extends object>(ref: T, competitionId: string | null): T {
  return competitionId === null ? ref : { ...ref, seenIn: competitionId };
}

/** What `resolveRef` answers for an id a reviewer has set aside (T-1338). */
const IGNORED = Symbol('ignored');

/** The entity types whose image the media store keeps. */
const IMAGED = new Set<EntityType>(['team', 'competition', 'person']);

export class IngestStore implements SquadStore {
  constructor(
    private readonly pool: Pool,
    private readonly resolver: RefResolver,
    private readonly media: MediaSink | null = null,
  ) {}

  /**
   * Hands a resolved entity's image address to the media store, when the
   * provider's ref carried one. Not a change to football data, so never
   * counted as one.
   */
  private async noteImage(
    provider: Provider,
    entityType: EntityType,
    entityId: string,
    payload: unknown,
  ): Promise<void> {
    if (this.media === null || !IMAGED.has(entityType)) return;
    const url =
      typeof payload === 'object' && payload !== null
        ? (payload as { imageUrl?: unknown }).imageUrl
        : undefined;
    if (typeof url !== 'string') return;
    await this.media.note(provider, entityType as 'team' | 'competition' | 'person', entityId, url);
  }

  /**
   * Which competition/season pairs this provider can be polled for: the
   * competitions it has a mapping for, on their current season. A competition
   * nobody has mapped is not polled — there would be nowhere to put the result.
   *
   * With a label, the season of that label instead, current or not, for the
   * competitions that have one: how a past season is backfilled once the
   * catalogue has added it (T-512, D-083). A competition without that season
   * is simply not a target.
   */
  async pollTargets(provider: Provider, seasonLabel: string | null = null): Promise<PollTarget[]> {
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
         JOIN season s ON s.competition_id = c.id
          AND ($2::text IS NULL AND s.is_current OR s.label = $2)
        WHERE pm.provider = $1 AND pm.entity_type = 'competition'
        ORDER BY c.name`,
      [provider, seasonLabel],
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

  /**
   * Finished fixtures of one competition, kicked off in `[fromIso, beforeIso)`,
   * whose detail has never been asked for (T-102), newest first: what a season
   * backfill leaves behind, since it writes the fixture list and nothing else.
   * A `null` start reaches every season of the competition, the past ones a
   * `--season` backfill loaded included (T-536).
   */
  async detailBacklog(
    provider: Provider,
    competitionId: string,
    fromIso: string | null,
    beforeIso: string,
    limit: number,
  ): Promise<{ externalId: string; fixtureId: string; kickoffAt: string }[]> {
    const { rows } = await this.pool.query<{
      external_id: string;
      fixture_id: string;
      kickoff_at: Date;
    }>(
      `SELECT pm.external_id, f.id AS fixture_id, f.kickoff_at
         FROM fixture f
         JOIN season s ON s.id = f.season_id
         JOIN provider_mapping pm
           ON pm.internal_id = f.id AND pm.entity_type = 'fixture' AND pm.provider = $1
        WHERE s.competition_id = $2 AND f.status = 'finished'
          AND ($3::timestamptz IS NULL OR f.kickoff_at >= $3) AND f.kickoff_at < $4
          AND NOT EXISTS (SELECT 1 FROM fixture_detail_fetch d WHERE d.fixture_id = f.id)
        ORDER BY f.kickoff_at DESC
        LIMIT $5`,
      [provider, competitionId, fromIso, beforeIso, limit],
    );
    return rows.map((r) => ({
      externalId: r.external_id,
      fixtureId: r.fixture_id,
      kickoffAt: r.kickoff_at.toISOString(),
    }));
  }

  /**
   * Records that the provider was asked for this fixture's detail. Not a change
   * to the match, so it is not counted as one and touches nothing else.
   */
  async markDetailFetched(provider: Provider, fixtureId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO fixture_detail_fetch (fixture_id, provider) VALUES ($1, $2)
       ON CONFLICT (fixture_id) DO UPDATE
         SET provider = EXCLUDED.provider, fetched_at = now()`,
      [fixtureId, provider],
    );
  }

  private async resolveId(
    provider: Provider,
    entityType: EntityType,
    externalId: string | null,
    payload: unknown = null,
  ): Promise<string | null> {
    const ref = await this.resolveRef(provider, entityType, externalId, payload);
    return ref === IGNORED ? null : ref;
  }

  /**
   * As `resolveId`, but tells an id a reviewer has set aside as not ours to
   * model (`unresolved_entity.status = 'ignored'`, T-1338) apart from one
   * still waiting for review: the first is out of coverage and skipped
   * quietly, the second is a gap the run reports.
   */
  private async resolveRef(
    provider: Provider,
    entityType: EntityType,
    externalId: string | null,
    payload: unknown = null,
  ): Promise<string | null | typeof IGNORED> {
    if (externalId === null || externalId === '') return null;
    // The review queue keeps what a reviewer needs to identify the entity; an
    // image address is not that, and stays out of it.
    const outcome = await this.resolver.resolve(
      { provider, entityType, externalId },
      withoutImage(payload),
    );
    if (outcome.kind === 'ignored') return IGNORED;
    if (outcome.kind !== 'resolved') return null;
    const internalId = (outcome as { internalId: string }).internalId;
    await this.noteImage(provider, entityType, internalId, payload);
    return internalId;
  }

  /**
   * The team a provider id names, or `null` if nobody has identified it. Used
   * by the standings check, which has to compare like with like: a provider's
   * spelling of a club is not a key (rule 1).
   */
  resolveTeam(
    provider: Provider,
    ref: { externalId: string; name: string },
    competitionId: string | null = null,
  ): Promise<string | null> {
    return this.resolveId(provider, 'team', ref.externalId, sighting(ref, competitionId));
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
    const home = await this.resolveRef(
      provider,
      'team',
      fixture.home.externalId,
      sighting(fixture.home, target.competitionId),
    );
    const away = await this.resolveRef(
      provider,
      'team',
      fixture.away.externalId,
      sighting(fixture.away, target.competitionId),
    );
    // A side a reviewer has set aside -- a youth, women's or club side in a
    // competition followed for its senior men's national teams (T-1338) -- is
    // out of coverage: the match is not ours to hold, so it is skipped and is
    // no gap to report, whatever the other side is.
    if (home === IGNORED || away === IGNORED) return NOTHING;
    const homeId = home;
    const awayId = away;
    if (homeId === null) unresolved.push(`team:${fixture.home.externalId}`);
    if (awayId === null) unresolved.push(`team:${fixture.away.externalId}`);
    if (homeId === null || awayId === null) return { changed: 0, unresolved };
    // The fixture list names the competition it was asked for; its logo is that competition's.
    if (fixture.competition.externalId === target.competitionExternalId) {
      await this.noteImage(provider, 'competition', target.competitionId, fixture.competition);
    }

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
    const stageId = await this.stageId(seasonId, fixture.stage?.name ?? null, fixture.round);
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
      return { changed, unresolved, seasonId, fixtureId };
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

  /**
   * Writes `fixture.group_name` from the provider's group tables (T-1333):
   * `members` is each team of a group, one group per team (`groupMembers`).
   * A fixture of the season's group stages takes the group both its teams are
   * in. Only fixtures whose two teams are both in the tables are touched: one
   * whose teams are in different groups is set to no group, and one with a
   * team the tables do not name is left as it is -- a group is never guessed.
   * A fixture of a stage that is not a group stage (a final between two teams
   * of one group, a play-off) is never given one. Returns the rows changed.
   */
  async assignGroups(
    seasonId: string,
    members: readonly { teamId: string; group: string }[],
  ): Promise<number> {
    if (members.length === 0) return 0;
    const { rowCount } = await this.pool.query(
      `WITH member (team_id, name) AS (
         SELECT * FROM unnest($2::uuid[], $3::text[])
       ),
       wanted AS (
         SELECT f.id, CASE WHEN mh.name = ma.name THEN mh.name END AS name
           FROM fixture f
           JOIN stage st ON st.id = f.stage_id AND st.kind = 'group'
           JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
           JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
           JOIN member mh ON mh.team_id = h.team_id
           JOIN member ma ON ma.team_id = a.team_id
          WHERE f.season_id = $1
       )
       UPDATE fixture f
          SET group_name = wanted.name
         FROM wanted
        WHERE f.id = wanted.id AND f.group_name IS DISTINCT FROM wanted.name`,
      [seasonId, members.map((m) => m.teamId), members.map((m) => m.group)],
    );
    return rowCount ?? 0;
  }

  /** The season's stage with that name, or `null`. Stages are never created here. */
  /**
   * The season's stage a fixture belongs to: by the stage name the adapter
   * read, or, when it read none, by the round the way `catalog --add-stage`
   * stamps it ("League A" owns "League A" and "League A - 3"). Without the
   * second rule every poll took back the stage an operator gave a round whose
   * words the adapter cannot classify, the Nations League's "League A - 1"
   * among them (T-1340).
   */
  async stageId(
    seasonId: string,
    name: string | null,
    round: string | null = null,
  ): Promise<string | null> {
    if (name !== null) {
      const { rows } = await this.pool.query<{ id: string }>(
        `SELECT id FROM stage WHERE season_id = $1 AND name = $2`,
        [seasonId, name],
      );
      return rows[0]?.id ?? null;
    }
    if (round === null) return null;
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM stage
        WHERE season_id = $1 AND ($2 = name OR left($2, length(name) + 3) = name || ' - ')
        ORDER BY length(name) DESC
        LIMIT 1`,
      [seasonId, round],
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
      const person = await this.resolveRef(
        provider,
        'person',
        incident.player?.externalId ?? null,
        incident.player,
      );
      const related = await this.resolveRef(
        provider,
        'person',
        incident.relatedPlayer?.externalId ?? null,
        incident.relatedPlayer,
      );
      const personId = person === IGNORED ? null : person;
      const relatedId = related === IGNORED ? null : related;
      // A person a reviewer has set aside (T-1338) is skipped like an unknown
      // one, but is no gap to report.
      if (incident.kind !== 'var' && personId === null) {
        if (person !== IGNORED)
          unresolved.push(`person:${incident.player?.externalId ?? 'unnamed'}`);
        continue;
      }
      if (incident.kind === 'substitution' && relatedId === null) {
        if (related !== IGNORED) {
          unresolved.push(`person:${incident.relatedPlayer?.externalId ?? 'unnamed'}`);
        }
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
      const personId = await this.resolveRef(provider, 'person', player.externalId, player);
      if (personId === null || personId === IGNORED) {
        // Set aside by a reviewer (T-1338): skipped, and no gap to report.
        if (personId === null) unresolved.push(`person:${player.externalId}`);
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

  /**
   * Each player's numbers (T-101). A player the catalogue does not hold is
   * resolved once, queued with the name the provider gave, and skipped: the
   * row is not written with a blank person, and adopting the person (D-079)
   * is what makes the next ask write it.
   */
  async savePlayerStatistics(
    provider: Provider,
    fixtureId: string,
    statistics: NormalisedPlayerStat[],
  ): Promise<WriteResult> {
    const participants = new Map<Side, string | null>([
      ['home', await this.participantId(fixtureId, 'home')],
      ['away', await this.participantId(fixtureId, 'away')],
    ]);
    const people = new Map<string, string | null | typeof IGNORED>();
    const unresolved = new Set<string>();
    let changed = 0;
    for (const stat of statistics) {
      const participantId = participants.get(stat.side) ?? null;
      if (participantId === null) continue;
      if (!people.has(stat.player.externalId)) {
        people.set(
          stat.player.externalId,
          await this.resolveRef(provider, 'person', stat.player.externalId, stat.player),
        );
      }
      const personId = people.get(stat.player.externalId) ?? null;
      if (personId === null || personId === IGNORED) {
        // Set aside by a reviewer (T-1338): skipped, and no gap to report.
        if (personId === null) unresolved.add(`person:${stat.player.externalId}`);
        continue;
      }
      const { rowCount } = await this.pool.query(
        `INSERT INTO fixture_player_stat (participant_id, person_id, metric, value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (participant_id, person_id, metric) DO UPDATE SET value = EXCLUDED.value
          WHERE fixture_player_stat.value IS DISTINCT FROM EXCLUDED.value`,
        [participantId, personId, stat.metric, stat.value],
      );
      changed += rowCount ?? 0;
    }
    return { changed, unresolved: [...unresolved] };
  }

  /**
   * Scheduled fixtures of one competition kicking off in `[fromIso, toIso)`
   * whose availability was never asked for, or last asked before
   * `staleBeforeIso` (T-103). Soonest first: the next match's team news is
   * the one a reader is waiting for.
   */
  async availabilityDue(
    provider: Provider,
    competitionId: string,
    fromIso: string,
    toIso: string,
    staleBeforeIso: string,
    limit: number,
  ): Promise<{ externalId: string; fixtureId: string }[]> {
    const { rows } = await this.pool.query<{ external_id: string; fixture_id: string }>(
      `SELECT pm.external_id, f.id AS fixture_id
         FROM fixture f
         JOIN season s ON s.id = f.season_id
         JOIN provider_mapping pm
           ON pm.internal_id = f.id AND pm.entity_type = 'fixture' AND pm.provider = $1
         LEFT JOIN fixture_availability_fetch a ON a.fixture_id = f.id
        WHERE s.competition_id = $2 AND f.status = 'scheduled'
          AND f.kickoff_at >= $3 AND f.kickoff_at < $4
          AND (a.fetched_at IS NULL OR a.fetched_at < $5)
        ORDER BY f.kickoff_at
        LIMIT $6`,
      [provider, competitionId, fromIso, toIso, staleBeforeIso, limit],
    );
    return rows.map((r) => ({ externalId: r.external_id, fixtureId: r.fixture_id }));
  }

  /**
   * The provider's whole answer for one fixture (T-103): each listed player
   * upserted, anyone it no longer lists deleted, and the ask recorded. A club
   * or a player the catalogue does not hold is queued and skipped, never
   * written as a blank. `reported_at` moves only when what was said changed.
   */
  async saveAvailability(
    provider: Provider,
    fixtureId: string,
    absences: NormalisedAbsence[],
  ): Promise<WriteResult> {
    const { rows: sides } = await this.pool.query<{ id: string; team_id: string }>(
      `SELECT id, team_id FROM fixture_participant WHERE fixture_id = $1`,
      [fixtureId],
    );
    const unresolved = new Set<string>();
    const listed: string[] = [];
    let changed = 0;
    for (const absence of absences) {
      const teamId = await this.resolveRef(provider, 'team', absence.team.externalId, absence.team);
      const participantId = sides.find((side) => side.team_id === teamId)?.id ?? null;
      // A side or a person a reviewer has set aside (T-1338) is skipped
      // without being reported.
      if (teamId === null) unresolved.add(`team:${absence.team.externalId}`);
      if (participantId === null) continue;
      const personId = await this.resolveRef(
        provider,
        'person',
        absence.player.externalId,
        absence.player,
      );
      if (personId === null || personId === IGNORED) {
        if (personId === null) unresolved.add(`person:${absence.player.externalId}`);
        continue;
      }
      listed.push(personId);
      const { rowCount } = await this.pool.query(
        `INSERT INTO fixture_absence (fixture_id, participant_id, person_id, status, kind, reason)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (fixture_id, person_id) DO UPDATE
           SET participant_id = EXCLUDED.participant_id, status = EXCLUDED.status,
               kind = EXCLUDED.kind, reason = EXCLUDED.reason, reported_at = now()
         WHERE (fixture_absence.participant_id, fixture_absence.status, fixture_absence.kind,
                fixture_absence.reason)
               IS DISTINCT FROM
               (EXCLUDED.participant_id, EXCLUDED.status, EXCLUDED.kind, EXCLUDED.reason)`,
        [fixtureId, participantId, personId, absence.status, absence.kind, absence.reason],
      );
      changed += rowCount ?? 0;
    }
    const gone = await this.pool.query(
      `DELETE FROM fixture_absence WHERE fixture_id = $1 AND NOT (person_id = ANY($2::uuid[]))`,
      [fixtureId, listed],
    );
    changed += gone.rowCount ?? 0;
    await this.pool.query(
      `INSERT INTO fixture_availability_fetch (fixture_id, provider) VALUES ($1, $2)
       ON CONFLICT (fixture_id) DO UPDATE SET provider = EXCLUDED.provider, fetched_at = now()`,
      [fixtureId, provider],
    );
    return { changed, unresolved: [...unresolved] };
  }

  // -- The squads job (T-1324): `SquadStore` in `squad-sweep.ts`. -------------

  async squadsAskedSince(provider: Provider, sinceIso: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM team_squad_fetch WHERE provider = $1 AND asked_at >= $2`,
      [provider, sinceIso],
    );
    return rows[0]?.n ?? 0;
  }

  /**
   * Mapped clubs with a match in any of the given seasons, never answered
   * first, then the longest unanswered; none answered since
   * `answeredBeforeIso` or asked since `askedBeforeIso`.
   *
   * Clubs only (T-1332): a national team's squad is players called up from
   * clubs, whose photos the clubs' squads and the national matches' own
   * line-ups already bring, so asking for it would spend requests on nothing.
   */
  async squadsDue(
    provider: Provider,
    seasonIds: string[],
    answeredBeforeIso: string,
    askedBeforeIso: string,
    limit: number,
  ): Promise<SquadTeam[]> {
    if (seasonIds.length === 0 || limit <= 0) return [];
    const { rows } = await this.pool.query<{ team_id: string; external_id: string }>(
      `SELECT pm.internal_id AS team_id, min(pm.external_id) AS external_id
         FROM provider_mapping pm
         JOIN team t ON t.id = pm.internal_id AND t.kind = 'club'
         LEFT JOIN team_squad_fetch q ON q.provider = pm.provider AND q.team_id = pm.internal_id
        WHERE pm.provider = $1 AND pm.entity_type = 'team'
          AND EXISTS (SELECT 1 FROM fixture_participant fp
                        JOIN fixture f ON f.id = fp.fixture_id
                       WHERE fp.team_id = pm.internal_id AND f.season_id = ANY($2::uuid[]))
          AND (q.answered_at IS NULL OR q.answered_at < $3)
          AND (q.asked_at IS NULL OR q.asked_at < $4)
        GROUP BY pm.internal_id, q.answered_at
        ORDER BY q.answered_at NULLS FIRST, pm.internal_id
        LIMIT $5`,
      [provider, seasonIds, answeredBeforeIso, askedBeforeIso, limit],
    );
    return rows.map((r) => ({ teamId: r.team_id, externalId: r.external_id }));
  }

  async markSquadAsked(provider: Provider, teamId: string, answered: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO team_squad_fetch (provider, team_id, asked_at, answered_at)
       VALUES ($1, $2, now(), CASE WHEN $3::boolean THEN now() END)
       ON CONFLICT (provider, team_id) DO UPDATE
         SET asked_at = now(),
             answered_at = CASE WHEN $3::boolean THEN now() ELSE team_squad_fetch.answered_at END`,
      [provider, teamId, answered],
    );
  }

  /** Read only: a provider id nobody has mapped is not ours, and is not queued. */
  async mappedPersons(provider: Provider, externalIds: string[]): Promise<Map<string, string>> {
    if (externalIds.length === 0) return new Map();
    const { rows } = await this.pool.query<{ external_id: string; internal_id: string }>(
      `SELECT external_id, internal_id FROM provider_mapping
        WHERE provider = $1 AND entity_type = 'person' AND external_id = ANY($2::text[])`,
      [provider, externalIds],
    );
    return new Map(rows.map((r) => [r.external_id, r.internal_id]));
  }
}
