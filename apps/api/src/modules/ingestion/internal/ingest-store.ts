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
 * The per-row upserts also leave an unchanged row out before the conflict is
 * reached (`INSERT ... SELECT ... WHERE NOT EXISTS` the identical row; T-1374,
 * D-192): `ON CONFLICT ... DO UPDATE` locks the existing row even when its
 * WHERE is false, and that lock is a WAL record, a full-page image on the
 * page's first change after a checkpoint, and a hint-bit image when it is
 * next read. The conflict clause stays for a row another writer changed or
 * inserted in between, so the counts are what they were.
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
  NormalisedLiveFixture,
  NormalisedPeriod,
  NormalisedSideLineup,
  NormalisedAbsence,
  NormalisedPlayerStat,
  NormalisedStat,
  Provider,
  Side,
} from '@fmip/ingestion';
import { PERIOD_KINDS } from '@fmip/ingestion';
import type { LineupCandidate } from './lineup-asks';
import type { EntityType } from './resolver';

/**
 * The kinds a provider's list can repeat by mistake but a match never can:
 * one player is not booked, sent off or substituted twice in the same minute
 * of the same match (a second booking is its own kind). A goal is not here:
 * a brace inside one minute is rare but real, and the score is the check.
 */
const NEVER_TWICE: ReadonlySet<NormalisedIncident['kind']> = new Set([
  'yellow_card',
  'second_yellow_card',
  'red_card',
  'substitution',
]);

/**
 * The provider's list without its repeats (T-1394, D-209): an incident of a
 * `NEVER_TWICE` kind identical to an earlier one -- side, minute, added time,
 * players and detail -- is dropped, so its place is not written and a stored
 * copy there is deleted (T-1382's rule). Production showed Portugal v Norway
 * (2026-10-04) booking F. Conceicao twice at 86'. Pure, so a unit spec holds
 * it.
 */
export function withoutRepeats(incidents: readonly NormalisedIncident[]): NormalisedIncident[] {
  const seen = new Set<string>();
  return incidents.filter((incident) => {
    if (!NEVER_TWICE.has(incident.kind)) return true;
    const key = JSON.stringify([
      incident.kind,
      incident.side,
      incident.minute,
      incident.addedTime,
      incident.player?.externalId ?? null,
      incident.relatedPlayer?.externalId ?? null,
      incident.detail,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
import type { SquadMember, SquadStore, SquadTeam } from './squad-sweep';

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

/** What the provider last said it covers for one season (T-1364). */
export interface SeasonFeedCoverage {
  /** Whether it reports absences; `null` until it gave an answer. */
  absences: boolean | null;
  askedAt: string;
  answeredAt: string | null;
}

/** What a write did: rows changed, and the provider ids that had no mapping. */
export interface WriteResult {
  changed: number;
  unresolved: string[];
  /** The season the fixture landed in, so the caller can recompute its coverage (T-027). */
  seasonId?: string;
  /** The fixture written, for a caller with more to write about it (T-830). */
  fixtureId?: string;
  /** Why the fixture was not written, for the run's partial reason (T-1410). */
  refused?: string;
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
    entityType: 'team' | 'competition' | 'person' | 'country',
    entityId: string,
    sourceUrl: string,
  ): Promise<void>;
}

/**
 * A ref without its image addresses (T-1320; a competition's country flag,
 * T-1611); anything else as it came.
 */
function withoutImage(payload: unknown): unknown {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('imageUrl' in payload || 'countryFlagUrl' in payload)
  ) {
    return payload;
  }
  const { imageUrl: _image, countryFlagUrl: _flag, ...rest } = payload as Record<string, unknown>;
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
  /**
   * The country our catalogue gives each competition, `null` for one of no
   * country, read once per process (T-1611): a competition does not move.
   */
  private readonly countryOfCompetition = new Map<string, string | null>();

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
   * Hands the flag of a competition's country to the media store (T-1611,
   * D-282), when the fixture list's competition ref carried one. The flag is
   * the country's, so it is noted against the country our catalogue gives the
   * competition -- never one guessed from the provider's country name (rule
   * 1); a competition of no country notes nothing. Like an image, never a
   * reason for the match write to fail.
   */
  private async noteCountryFlag(
    provider: Provider,
    competitionId: string,
    payload: unknown,
  ): Promise<void> {
    if (this.media === null) return;
    const url =
      typeof payload === 'object' && payload !== null
        ? (payload as { countryFlagUrl?: unknown }).countryFlagUrl
        : undefined;
    if (typeof url !== 'string') return;
    let countryId = this.countryOfCompetition.get(competitionId);
    if (countryId === undefined) {
      try {
        const { rows } = await this.pool.query<{ country_id: string | null }>(
          `SELECT country_id FROM competition WHERE id = $1`,
          [competitionId],
        );
        countryId = rows[0]?.country_id ?? null;
      } catch {
        return;
      }
      this.countryOfCompetition.set(competitionId, countryId);
    }
    if (countryId === null) return;
    await this.media.note(provider, 'country', countryId, url);
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
   * The polled competitions' scheduled and live matches kicking off in
   * `(fromIso, toIso]` that this provider has an id for, and whether both
   * sides' line-ups are stored (T-1625): what `lineupAsks` chooses from.
   */
  async lineupCandidates(
    provider: Provider,
    competitionIds: string[],
    fromIso: string,
    toIso: string,
  ): Promise<LineupCandidate[]> {
    if (competitionIds.length === 0) return [];
    const { rows } = await this.pool.query<{
      external_id: string;
      fixture_id: string;
      kickoff_at: Date;
      status: string;
      announced: boolean;
    }>(
      `SELECT pm.external_id, f.id AS fixture_id, f.kickoff_at, f.status,
              (SELECT count(DISTINCT fp.side)
                 FROM fixture_participant fp
                WHERE fp.fixture_id = f.id
                  AND EXISTS (SELECT 1 FROM lineup l WHERE l.participant_id = fp.id)) = 2
                AS announced
         FROM fixture f
         JOIN season s ON s.id = f.season_id
         JOIN provider_mapping pm
           ON pm.internal_id = f.id AND pm.entity_type = 'fixture' AND pm.provider = $1
        WHERE s.competition_id = ANY($2::uuid[])
          AND f.status IN ('scheduled', 'live')
          AND f.kickoff_at > $3 AND f.kickoff_at <= $4
        ORDER BY f.kickoff_at`,
      [provider, competitionIds, fromIso, toIso],
    );
    return rows.map((r) => ({
      externalId: r.external_id,
      fixtureId: r.fixture_id,
      kickoffAt: r.kickoff_at.toISOString(),
      status: r.status,
      announced: r.announced,
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
   * Tells the open live pages that the live list answered about these
   * matches without changing them (T-1394, D-209): one `fixture_change`
   * notification each, as the row triggers of migration 1758700000000 raise,
   * so every stream re-sends its snapshot with the new `live_answered_at`.
   * Called once the run is recorded, so the snapshot reads this run. Only
   * for matches whose clock stands still (half-time, added time, a break, a
   * suspension): in play the minute moves and the row's own trigger speaks.
   */
  async noteLiveAnswered(fixtureIds: readonly string[]): Promise<void> {
    if (fixtureIds.length === 0) return;
    await this.pool.query(
      `SELECT pg_notify('fixture_change', json_build_object(
                'fixture_id', id,
                'table', 'live_answer',
                'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text)
         FROM unnest($1::uuid[]) AS id`,
      [[...new Set(fixtureIds)]],
    );
  }

  /**
   * Records that a season's fixture list was answered (T-1371, D-189): the
   * window asked for, or the whole season. One row write per season and
   * provider per run, never one per match: the match page's "last checked".
   */
  async notePolled(
    provider: Provider,
    seasonId: string,
    asked: { from: string; to: string; wholeSeason?: boolean | undefined },
  ): Promise<void> {
    if (asked.wholeSeason === true) {
      await this.pool.query(
        `INSERT INTO season_fixture_poll (season_id, provider, season_polled_at)
         VALUES ($1, $2, now())
         ON CONFLICT (season_id, provider) DO UPDATE SET season_polled_at = now()`,
        [seasonId, provider],
      );
      return;
    }
    await this.pool.query(
      `INSERT INTO season_fixture_poll
         (season_id, provider, window_from, window_to, window_polled_at)
       VALUES ($1, $2, $3::date, $4::date, now())
       ON CONFLICT (season_id, provider) DO UPDATE
         SET window_from = EXCLUDED.window_from, window_to = EXCLUDED.window_to,
             window_polled_at = now()`,
      [seasonId, provider, asked.from, asked.to],
    );
  }

  /**
   * Writes one fixture and everything the fixture list carries: the two
   * participants and every score the provider supplied. Creates the fixture the
   * first time, updates only what changed afterwards.
   */
  async saveFixture(
    provider: Provider,
    target: PollTarget,
    fixture: NormalisedFixture & Pick<NormalisedLiveFixture, 'halfTimeBreak'>,
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
    // The fixture list names the competition it was asked for; its logo is
    // that competition's, and its flag that of the competition's country.
    if (fixture.competition.externalId === target.competitionExternalId) {
      await this.noteImage(provider, 'competition', target.competitionId, fixture.competition);
      await this.noteCountryFlag(provider, target.competitionId, fixture.competition);
    }

    const venueId = await this.resolveId(
      provider,
      'venue',
      fixture.venue?.externalId ?? null,
      fixture.venue,
    );
    // The referee is plain name text (T-1438, D-229): never resolved to a
    // person, never a key. An answer that names nobody keeps the stored name
    // (an appointment is not withdrawn by a list that leaves it out).
    const refereeName = fixture.referee?.name.trim() || null;
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
    // The half-time interval (T-1551): what the live list says while the
    // match is live; a list that does not say keeps the stored answer
    // (`null`), and a match that is not live is at no interval.
    const atHalfTime = fixture.status === 'live' ? (fixture.halfTimeBreak ?? null) : false;

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
              is_neutral_venue, referee_name, at_half_time)
           VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, COALESCE($9::boolean, false))
           RETURNING id`,
          [
            seasonId,
            stageId,
            fixture.round,
            fixture.kickoffAt,
            fixture.status,
            minute,
            venueId,
            refereeName,
            atHalfTime,
          ],
        );
        fixtureId = rows[0]?.id ?? null;
        if (fixtureId === null) throw new Error('insert into fixture returned no id');
        changed += 1;
      } else {
        const { rowCount } = await client.query(
          `UPDATE fixture
              SET stage_id = $2, round = $3, kickoff_at = $4, status = $5, minute = $6,
                  venue_id = $7, referee_name = COALESCE($8, referee_name),
                  at_half_time = COALESCE($9::boolean, at_half_time)
            WHERE id = $1
              AND (stage_id, round, kickoff_at, status, minute, venue_id, referee_name,
                   at_half_time)
                  IS DISTINCT FROM ($2, $3, $4::timestamptz, $5, $6::smallint, $7,
                                    COALESCE($8, referee_name),
                                    COALESCE($9::boolean, at_half_time))`,
          [
            fixtureId,
            stageId,
            fixture.round,
            fixture.kickoffAt,
            fixture.status,
            minute,
            venueId,
            refereeName,
            atHalfTime,
          ],
        );
        changed += rowCount ?? 0;
      }

      const turned = await this.turnRound(client, fixtureId, homeId, awayId);
      if (turned === 'held') {
        await client.query('ROLLBACK');
        return {
          changed: 0,
          unresolved,
          refused:
            `${fixture.externalId}: home and away swapped by the provider, ` +
            'and the match already carries forecasts, predictions or detail; left for review',
        };
      }
      changed += turned;
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

  /**
   * A match the provider has turned round (T-1410): the team we hold at home
   * now plays away and the other way about. Writing one side at a time would
   * put the same team on both sides for a moment, which
   * `fixture_participant_team_once` refuses -- and that refusal once failed a
   * whole daily schedule sweep (provider fixture 1552933, 2026-10-14).
   *
   * Nothing hangs off the two rows yet (the usual case: a match months away),
   * so they are removed and the upserts that follow write the new sides. Once
   * anything reads the old orientation -- a forecast's home probability, a
   * member's predicted score, a line-up, an incident -- turning it round is a
   * decision about stored history, not ingestion, so the match is held as it
   * is and named in the run's partial reason. An `unavailable` forecast carries
   * no numbers, so it reads no side and does not hold the match (T-1412: every
   * match in a league without a model division has one, and holding them also
   * held their kick-off changes). Returns the rows removed, or `'held'`.
   */
  private async turnRound(
    client: PoolClient,
    fixtureId: string,
    homeId: string,
    awayId: string,
  ): Promise<number | 'held'> {
    const { rows } = await client.query<{ side: Side; team_id: string }>(
      `SELECT side, team_id FROM fixture_participant WHERE fixture_id = $1`,
      [fixtureId],
    );
    const held = new Map(rows.map((row) => [row.side, row.team_id]));
    if (held.get('home') !== awayId || held.get('away') !== homeId) return 0;
    const { rows: hanging } = await client.query<{ hanging: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM forecast WHERE fixture_id = $1 AND status <> 'unavailable')
           OR EXISTS (SELECT 1 FROM user_prediction WHERE fixture_id = $1)
           OR EXISTS (SELECT 1 FROM founder_analysis WHERE fixture_id = $1)
           OR EXISTS (SELECT 1 FROM community_analysis WHERE fixture_id = $1)
           OR EXISTS (SELECT 1 FROM match_summary WHERE fixture_id = $1)
           OR EXISTS (
                SELECT 1 FROM fixture_participant p
                 WHERE p.fixture_id = $1
                   AND (EXISTS (SELECT 1 FROM incident WHERE participant_id = p.id)
                     OR EXISTS (SELECT 1 FROM lineup WHERE participant_id = p.id)
                     OR EXISTS (SELECT 1 FROM fixture_stat WHERE participant_id = p.id)
                     OR EXISTS (SELECT 1 FROM fixture_player_stat WHERE participant_id = p.id)
                     OR EXISTS (SELECT 1 FROM fixture_absence WHERE participant_id = p.id)
                     OR EXISTS (SELECT 1 FROM power_index WHERE participant_id = p.id)
                     OR EXISTS (SELECT 1 FROM panel_post WHERE link_participant_id = p.id)))
           AS hanging`,
      [fixtureId],
    );
    if (hanging[0]?.hanging === true) return 'held';
    const { rowCount } = await client.query(
      `DELETE FROM fixture_participant WHERE fixture_id = $1`,
      [fixtureId],
    );
    return rowCount ?? 0;
  }

  private async upsertParticipant(
    client: PoolClient,
    fixtureId: string,
    teamId: string,
    side: Side,
  ): Promise<number> {
    const { rowCount } = await client.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       SELECT $1::uuid, $2::uuid, $3::text
        WHERE NOT EXISTS (
                SELECT 1 FROM fixture_participant
                 WHERE fixture_id = $1::uuid AND side = $3::text AND team_id = $2::uuid)
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
         SELECT $1::uuid, $2::text, $3::smallint, $4::smallint
          WHERE NOT EXISTS (
                  SELECT 1 FROM fixture_score
                   WHERE fixture_id = $1::uuid AND kind = $2::text
                     AND (home, away) IS NOT DISTINCT FROM ($3::smallint, $4::smallint))
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
   *
   * `stageId` is the stage the tables are for when the provider names one
   * (T-1399): Argentina's Apertura and Clausura each have a group A, and a
   * team's Apertura zone says nothing of its Clausura matches. Null reads
   * the tables across every group stage of the season, as before.
   */
  async assignGroups(
    seasonId: string,
    members: readonly { teamId: string; group: string }[],
    stageId: string | null = null,
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
          WHERE f.season_id = $1 AND ($4::uuid IS NULL OR f.stage_id = $4::uuid)
       )
       UPDATE fixture f
          SET group_name = wanted.name
         FROM wanted
        WHERE f.id = wanted.id AND f.group_name IS DISTINCT FROM wanted.name`,
      [seasonId, members.map((m) => m.teamId), members.map((m) => m.group), stageId],
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
      // The named stage, unless an operator has split a round of it into a
      // stage of its own (T-1399, D-214): Argentina's "Apertura - Round of
      // 16" is read as stage "Apertura", and the stage "Apertura - Round of
      // 16" (`catalog --add-stage`) keeps it out of the zones' tables. Only a
      // stage named "<name> - ..." can outrank the name.
      const { rows } = await this.pool.query<{ id: string }>(
        `SELECT id FROM stage
          WHERE season_id = $1
            AND (name = $2
                 OR ($3::text IS NOT NULL
                     AND left(name, length($2) + 3) = $2 || ' - '
                     AND ($3 = name OR left($3, length(name) + 3) = name || ' - ')))
          ORDER BY length(name) DESC
          LIMIT 1`,
        [seasonId, name, round],
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
         SELECT $1::uuid, $2::text, $3::smallint, $4::timestamptz, $5::timestamptz, $6::smallint
          WHERE NOT EXISTS (
                  SELECT 1 FROM fixture_period
                   WHERE fixture_id = $1::uuid AND kind = $2::text
                     AND (started_at, ended_at, added_minutes)
                         IS NOT DISTINCT FROM ($4::timestamptz, $5::timestamptz, $6::smallint))
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
   *
   * `sequence` is the incident's place in the provider's list, so the list is
   * the whole truth for the fixture (T-1382): a row at a place this answer did
   * not write -- past the end of a list that shrank, or where the answer now
   * holds an incident we skipped -- is a different, older incident, and is
   * deleted. Left behind, it showed the same substitution twice and hid the
   * goal that had taken its place. An empty answer deletes nothing: a
   * provider's momentary empty list must not wipe a timeline that post-match
   * will not ask for again. A booking or substitution the list repeats is
   * written once (`withoutRepeats`, T-1394).
   */
  async saveIncidents(
    provider: Provider,
    fixtureId: string,
    answer: NormalisedIncident[],
  ): Promise<WriteResult> {
    // A repeat is not written, so a copy stored at its place goes (T-1394).
    const incidents = withoutRepeats(answer);
    const unresolved: string[] = [];
    const participants = new Map<Side, string | null>([
      ['home', await this.participantId(fixtureId, 'home')],
      ['away', await this.participantId(fixtureId, 'away')],
    ]);
    let changed = 0;
    const written: number[] = [];

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
         SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::smallint, $7::smallint,
                $8::smallint, $9::text
          WHERE NOT EXISTS (
                  SELECT 1 FROM incident
                   WHERE fixture_id = $1::uuid AND sequence = $8::smallint
                     AND (participant_id, person_id, related_person_id, kind, minute,
                          added_time, detail)
                         IS NOT DISTINCT FROM
                         ($2::uuid, $3::uuid, $4::uuid, $5::text, $6::smallint, $7::smallint,
                          $9::text))
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
      written.push(incident.sequence);
    }
    if (incidents.length > 0) {
      const { rowCount } = await this.pool.query(
        `DELETE FROM incident WHERE fixture_id = $1 AND NOT (sequence = ANY($2::smallint[]))`,
        [fixtureId, written],
      );
      changed += rowCount ?? 0;
    }
    return { changed, unresolved };
  }

  /**
   * A club's colour from the shirts it wore at home (T-1416, D-218):
   * `team_kit_colour`, written as `kits` unless an editor set one, which this
   * never overwrites. Not a change to any match, so not counted as one.
   */
  async refreshTeamColour(teamId: string): Promise<void> {
    await this.pool.query(
      `UPDATE team t
          SET colour = d.colour,
              colour_source = CASE WHEN d.colour IS NULL THEN NULL ELSE 'kits' END
         FROM (SELECT team_kit_colour($1) AS colour) d
        WHERE t.id = $1
          AND t.colour_source IS DISTINCT FROM 'editor'
          AND t.colour IS DISTINCT FROM d.colour`,
      [teamId],
    );
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
    // The side's shirt in this match (T-1416, D-218). An answer without one
    // keeps the shirt already stored: no colour is not a different colour.
    const { rows: participant, rowCount } = await this.pool.query<{ team_id: string }>(
      `UPDATE fixture_participant
          SET formation = $2, coach_id = $3, kit_colour = COALESCE($4, kit_colour)
        WHERE id = $1
          AND (formation, coach_id, kit_colour) IS DISTINCT FROM ($2, $3, COALESCE($4, kit_colour))
        RETURNING team_id`,
      [participantId, lineup.formation, coachId, lineup.kitColour],
    );
    let changed = rowCount ?? 0;
    const teamId = participant[0]?.team_id;
    if (side === 'home' && lineup.kitColour !== null && teamId !== undefined) {
      await this.refreshTeamColour(teamId);
    }

    const listed: { player: NormalisedSideLineup['players'][number]; personId: string }[] = [];
    for (const player of lineup.players) {
      const personId = await this.resolveRef(provider, 'person', player.externalId, player);
      if (personId === null || personId === IGNORED) {
        // Set aside by a reviewer (T-1338): skipped, and no gap to report.
        if (personId === null) unresolved.push(`person:${player.externalId}`);
        continue;
      }
      listed.push({ player, personId });
    }

    // The feed is the whole side (T-539): a player it no longer lists was a
    // provider correction, so their row goes. An empty feed removes nothing.
    if (lineup.players.length > 0) {
      const { rowCount: removed } = await this.pool.query(
        `DELETE FROM lineup WHERE participant_id = $1 AND NOT (person_id = ANY($2::uuid[]))`,
        [participantId, listed.map((entry) => entry.personId)],
      );
      changed += removed ?? 0;
    }

    for (const { player, personId } of listed) {
      if (player.shirtNumber !== null) {
        // A shirt the provider moved to this player is released by its former
        // holder first, or the unique (participant, shirt) index refuses it.
        const { rowCount: released } = await this.pool.query(
          `UPDATE lineup SET shirt_number = NULL
            WHERE participant_id = $1 AND shirt_number = $2 AND person_id <> $3`,
          [participantId, player.shirtNumber, personId],
        );
        changed += released ?? 0;
      }
      // The place in the shape (T-1397, D-212) is compared like every other
      // field, so a fetch that now carries it fills a row stored without one.
      const { rowCount: written } = await this.pool.query(
        `INSERT INTO lineup (participant_id, person_id, role, shirt_number, position, is_captain,
                             grid_row, grid_col)
         SELECT $1::uuid, $2::uuid, $3::text, $4::smallint, $5::text, $6::boolean,
                $7::smallint, $8::smallint
          WHERE NOT EXISTS (
                  SELECT 1 FROM lineup
                   WHERE participant_id = $1::uuid AND person_id = $2::uuid
                     AND (role, shirt_number, position, is_captain, grid_row, grid_col)
                         IS NOT DISTINCT FROM ($3::text, $4::smallint, $5::text, $6::boolean,
                                               $7::smallint, $8::smallint))
         ON CONFLICT (participant_id, person_id) DO UPDATE
            SET role = EXCLUDED.role,
                shirt_number = EXCLUDED.shirt_number,
                position = EXCLUDED.position,
                is_captain = EXCLUDED.is_captain,
                grid_row = EXCLUDED.grid_row,
                grid_col = EXCLUDED.grid_col
          WHERE (lineup.role, lineup.shirt_number, lineup.position, lineup.is_captain,
                 lineup.grid_row, lineup.grid_col)
                IS DISTINCT FROM
                (EXCLUDED.role, EXCLUDED.shirt_number, EXCLUDED.position, EXCLUDED.is_captain,
                 EXCLUDED.grid_row, EXCLUDED.grid_col)`,
        [
          participantId,
          personId,
          player.role,
          player.shirtNumber,
          player.position,
          player.isCaptain,
          player.grid?.row ?? null,
          player.grid?.col ?? null,
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
         SELECT $1::uuid, $2::text, $3::numeric
          WHERE NOT EXISTS (
                  SELECT 1 FROM fixture_stat
                   WHERE participant_id = $1::uuid AND metric = $2::text
                     AND value IS NOT DISTINCT FROM $3::numeric)
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
         SELECT $1::uuid, $2::uuid, $3::text, $4::numeric
          WHERE NOT EXISTS (
                  SELECT 1 FROM fixture_player_stat
                   WHERE participant_id = $1::uuid AND person_id = $2::uuid
                     AND metric = $3::text AND value IS NOT DISTINCT FROM $4::numeric)
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
  ): Promise<{ externalId: string; fixtureId: string; seasonId: string; seasonLabel: string }[]> {
    const { rows } = await this.pool.query<{
      external_id: string;
      fixture_id: string;
      season_id: string;
      label: string;
    }>(
      `SELECT pm.external_id, f.id AS fixture_id, s.id AS season_id, s.label
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
    return rows.map((r) => ({
      externalId: r.external_id,
      fixtureId: r.fixture_id,
      seasonId: r.season_id,
      seasonLabel: r.label,
    }));
  }

  /**
   * What the provider last said it covers for one season (T-1364): whether it
   * reports absences (`null` until it answered), and when it was last asked
   * and answered. `null` when it was never asked.
   */
  async seasonFeedCoverage(
    provider: Provider,
    seasonId: string,
  ): Promise<SeasonFeedCoverage | null> {
    const { rows } = await this.pool.query<{
      absences: boolean | null;
      asked_at: Date;
      answered_at: Date | null;
    }>(
      `SELECT absences, asked_at, answered_at
         FROM season_feed_coverage WHERE season_id = $1 AND provider = $2`,
      [seasonId, provider],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      absences: row.absences,
      askedAt: row.asked_at.toISOString(),
      answeredAt: row.answered_at?.toISOString() ?? null,
    };
  }

  /**
   * Records an ask for a season's coverage (T-1364): with the provider's
   * answer when it gave one, else only that it was asked, keeping the last
   * answer it did give.
   */
  async saveSeasonFeedCoverage(
    provider: Provider,
    seasonId: string,
    absences: boolean | null,
    atIso: string,
  ): Promise<number> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO season_feed_coverage (season_id, provider, absences, asked_at, answered_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $3::boolean IS NULL THEN NULL ELSE $4::timestamptz END)
       ON CONFLICT (season_id, provider) DO UPDATE
         SET asked_at = EXCLUDED.asked_at,
             absences = COALESCE(EXCLUDED.absences, season_feed_coverage.absences),
             answered_at = COALESCE(EXCLUDED.answered_at, season_feed_coverage.answered_at)`,
      [seasonId, provider, absences, atIso],
    );
    return rowCount ?? 0;
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
         SELECT $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text
          WHERE NOT EXISTS (
                  SELECT 1 FROM fixture_absence
                   WHERE fixture_id = $1::uuid AND person_id = $3::uuid
                     AND (participant_id, status, kind, reason)
                         IS NOT DISTINCT FROM ($2::uuid, $4::text, $5::text, $6::text))
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

  /**
   * The club's listed squad, replaced as a whole (T-1428): a player the new
   * listing leaves out is no longer in the squad. A person listed for two
   * clubs at once (a loan, a transfer read before the old club's next
   * listing) is in both until that club is asked again.
   */
  async replaceSquadListing(
    provider: Provider,
    teamId: string,
    listed: number,
    members: SquadMember[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM team_squad_member WHERE team_id = $1`, [teamId]);
      if (members.length > 0) {
        await client.query(
          `INSERT INTO team_squad_member (team_id, person_id, provider, shirt_number, position)
           SELECT $1, m.person_id, $2, m.shirt_number, m.position
             FROM unnest($3::uuid[], $4::smallint[], $5::text[])
                  AS m (person_id, shirt_number, position)
           ON CONFLICT (team_id, person_id) DO NOTHING`,
          [
            teamId,
            provider,
            members.map((m) => m.personId),
            members.map((m) => m.shirtNumber),
            members.map((m) => m.position),
          ],
        );
      }
      await client.query(
        `UPDATE team_squad_fetch SET listed = $3 WHERE provider = $1 AND team_id = $2`,
        [provider, teamId, listed],
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
