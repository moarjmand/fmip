import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type { AdapterResult, NormalisedStanding, Provider, ProviderAdapter } from '@fmip/ingestion';
import { PG_POOL } from '../../database/database.module';
import { StandingsService } from '../standings/standings.service';
import { CoverageService } from './coverage.service';
import { IngestRunsService } from './ingest-runs.service';
import { EntityResolverService } from './ingestion.service';
import { IngestStore, type PollTarget, type WriteResult } from './internal/ingest-store';
import {
  INGESTION_SOURCES,
  REPLAY_QUERY,
  type IngestJob,
  type IngestionSources,
  type JobSource,
} from './internal/sources';

/** How far back and forward the fixtures job looks, in days. */
export const FIXTURE_WINDOW_BACK_DAYS = 2;
export const FIXTURE_WINDOW_FORWARD_DAYS = 7;
/** How close to kick-off a match has to be before the live job asks about it. */
export const LIVE_WINDOW_BEFORE_MINUTES = 30;
export const LIVE_WINDOW_AFTER_MINUTES = 210;
/** How many fixtures one lineups or post-match run will spend requests on. */
export const DETAIL_BATCH = 10;
/**
 * How many finished fixtures that never had their detail one post-match run
 * also asks about (T-102): 20 every half hour is 960 requests a day at most,
 * and a backfilled season's few hundred matches are filled within a day.
 * `INGESTION_BACKLOG_BATCH` raises it where the plan allows (T-501): fifteen
 * competitions backfilled at once are a thousand matches, a day and more at
 * twenty.
 */
export const DETAIL_BACKLOG_BATCH = 20;
/** A ceiling on the setting, so a typo cannot spend a day's plan in one run. */
export const MAX_BACKLOG_BATCH = 200;

/** The backlog batch this deployment asked for, or the default for anything else. */
export function backlogBatch(raw: string | undefined): number {
  const value = Number((raw ?? '').trim());
  return Number.isInteger(value) && value > 0 && value <= MAX_BACKLOG_BATCH
    ? value
    : DETAIL_BACKLOG_BATCH;
}
/**
 * Availability (T-103): matches kicking off within three days are asked about,
 * each again once its last answer is three hours old, at most ten per run of
 * the five-minute line-ups job -- a weekend's sixty matches cost about twenty
 * requests an hour.
 */
export const AVAILABILITY_WINDOW_HOURS = 72;
export const AVAILABILITY_STALE_HOURS = 3;
export const AVAILABILITY_BATCH = 10;

/** What one job run did. Returned so a caller (a test, the scheduler) can assert on it. */
export interface JobReport {
  job: IngestJob;
  provider: Provider | null;
  /** Items the provider supplied. */
  itemsSeen: number;
  /** Rows that really changed. Zero on a replay of the same data. */
  itemsWritten: number;
  /** Set when the run was partial: the reason, in words. */
  partial?: string;
}

function dayIso(now: Date, offsetDays: number): string {
  const day = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return day.toISOString().slice(0, 10);
}

/** Postgres unique violation: the "already running" lock on `ingest_run`. */
const UNIQUE_VIOLATION = '23505';

/** The hour (UTC) at which the hourly fixtures run also reads each season's remaining schedule (T-505). */
export const SCHEDULE_SWEEP_HOUR = 4;

/**
 * The dates the fixtures job asks a competition about (T-505).
 *
 * Hourly, a window around now: enough to catch a postponement or a moved
 * kick-off. Once a day, from the same start to the season's end, because the
 * provider publishes a season's schedule long before its matches and the
 * question costs the same one request either way -- without it a competition
 * or team page never knows a fixture more than a week ahead. A season whose
 * recorded end is already inside the window is asked for the window.
 */
export function fixtureWindow(
  now: Date,
  seasonEnd: string,
): { from: string; to: string; sweep: boolean } {
  const from = dayIso(now, -FIXTURE_WINDOW_BACK_DAYS);
  const to = dayIso(now, FIXTURE_WINDOW_FORWARD_DAYS);
  const sweep = now.getUTCHours() === SCHEDULE_SWEEP_HOUR;
  return { from, to: sweep && seasonEnd > to ? seasonEnd : to, sweep };
}

function describe(error: { kind: string; message: string }): string {
  return `${error.kind}: ${error.message}`;
}

/**
 * The scheduled ingestion jobs (T-026).
 *
 * Five jobs, one method each, every one of them run inside
 * `IngestRunsService.track` so that its outcome is a row in `ingest_run` and a
 * failure is visible on `GET /health/ingestion` without SSH (T-071). Each job
 * is a fetch, a resolve and an upsert; the writers in `internal/ingest-store.ts`
 * only write rows that changed, so running any job twice over the same provider
 * state writes nothing the second time. That is the acceptance criterion, and
 * `ingestion-jobs.http.spec.ts` asserts it against a real database.
 *
 * A job never throws for a provider that said no. A refusal — a quota, a plan
 * that does not serve this season, a competition off the tier — is a `partial`
 * run naming what happened, because the data is missing for a reason we can
 * state, which is what the coverage state (T-027) is for. Only something we did
 * not anticipate is allowed to fail the run.
 */
/**
 * One question to the provider per live tick, whatever the number of
 * competitions (T-501).
 *
 * The provider's live list is one answer for everything playing, and the job
 * used to ask for it once per competition with a match in the window: one
 * request a minute with the first five leagues, fifteen on a Saturday with
 * fifteen. Asking once with every id we hold, and sending each fixture back
 * to the competition it belongs to, spends one. A competition with nothing in
 * the window still asks nothing.
 */
export function liveQuestion(known: { target: PollTarget; externalIds: string[] }[]): {
  externalIds: string[];
  targetOf: Map<string, PollTarget>;
  seasonLabels: string[];
} {
  const targetOf = new Map<string, PollTarget>();
  const seasonLabels: string[] = [];
  for (const { target, externalIds } of known) {
    if (externalIds.length === 0) continue;
    seasonLabels.push(target.seasonLabel);
    for (const id of externalIds) targetOf.set(id, target);
  }
  return { externalIds: [...targetOf.keys()], targetOf, seasonLabels };
}

/**
 * What the provider's table row says we are missing, or `null` (T-030).
 *
 * A club that has played nothing has nothing we could be missing: a cup's
 * league stage is tabled before its first matchday, every row zero, and
 * reading that as a gap made the check partial every hour until the first
 * match (the Conference League, 2026-09-26).
 */
export function tableGap(
  team: string,
  providerPlayed: number,
  heldPlayed: number | undefined,
): string | null {
  if (heldPlayed === undefined) {
    return providerPlayed > 0
      ? `${team}: provider ${providerPlayed} played, we hold no table row`
      : null;
  }
  return heldPlayed !== providerPlayed
    ? `${team}: provider ${providerPlayed} played, we have ${heldPlayed}`
    : null;
}

@Injectable()
export class IngestionJobsService {
  private readonly log = new Logger('Ingestion');
  private readonly store: IngestStore;
  private readonly backlogBatch = backlogBatch(process.env.INGESTION_BACKLOG_BATCH);

  constructor(
    @Inject(PG_POOL) pool: Pool,
    @Inject(INGESTION_SOURCES) private readonly sources: IngestionSources,
    private readonly runs: IngestRunsService,
    private readonly standings: StandingsService,
    private readonly coverage: CoverageService,
    resolver: EntityResolverService,
  ) {
    this.store = new IngestStore(pool, resolver);
  }

  /** Runs one job by name. The scheduler and the tests both come through here. */
  run(job: IngestJob, now: Date = new Date()): Promise<JobReport> {
    switch (job) {
      case 'fixtures':
        return this.fixtures(now);
      case 'live':
        return this.live(now);
      case 'lineups':
        return this.lineups(now);
      case 'standings':
        return this.standingsCheck(now);
      case 'post_match':
        return this.postMatch(now);
    }
  }

  /**
   * The schedule of a fixture and everything the list carries: teams, kick-off,
   * status, scores. The window is a few days either side of now, so a
   * postponement or a rearranged kick-off is picked up, not only new matches.
   */
  fixtures(now: Date = new Date()): Promise<JobReport> {
    const replay = this.sources.kind === 'replay';
    const sweep = !replay && now.getUTCHours() === SCHEDULE_SWEEP_HOUR;
    return this.track(
      'fixtures',
      (source, targets) =>
        this.ingestFixtures(source, targets, (target) => {
          if (replay) return { from: REPLAY_QUERY.from, to: REPLAY_QUERY.to };
          const { from, to } = fixtureWindow(now, target.seasonEnd);
          return { from, to };
        }),
      // The daily sweep is the same job over a wider span, and says so (T-505).
      sweep ? 'schedule' : null,
    );
  }

  /**
   * The same ingestion over a season's whole span, once (T-030).
   *
   * `fixtures` asks for a window around now, which is right for a schedule and
   * wrong for a deployment that has just been given a licence: it learns about
   * this week and nothing before it. A standings table then refuses to write,
   * correctly -- "provider 5 played, we have 1" -- because a table beside a
   * match list that contradicts it is worse than no table.
   *
   * Recorded as a `fixtures` run with the scope `backfill`, not as a job of its
   * own: it is the same work over a wider window, `ingest_run.job` names the
   * five jobs there are, and the open-run lock is what stops it colliding with
   * the schedule. Not scheduled, because a season starts once.
   *
   * With a season label it reads that season instead, for every competition
   * the catalogue holds it for -- a past season added with `--add-season` so
   * the model can learn from it (T-512, D-083). A past season is asked for
   * its own span and no further, and the run's scope names the label.
   */
  backfill(now: Date = new Date(), seasonLabel: string | null = null): Promise<JobReport> {
    return this.track(
      'fixtures',
      (source, targets) => {
        const replay = this.sources.kind === 'replay';
        return this.ingestFixtures(source, targets, (target) => {
          if (replay) return { from: REPLAY_QUERY.from, to: REPLAY_QUERY.to };
          if (seasonLabel !== null) return { from: target.seasonStart, to: target.seasonEnd };
          return {
            from: target.seasonStart,
            // To the season's end: the provider publishes the schedule
            // ahead, and the whole season is still one request (T-505).
            to:
              target.seasonEnd > dayIso(now, FIXTURE_WINDOW_FORWARD_DAYS)
                ? target.seasonEnd
                : dayIso(now, FIXTURE_WINDOW_FORWARD_DAYS),
          };
        });
      },
      seasonLabel === null ? 'backfill' : `backfill ${seasonLabel}`,
      seasonLabel,
    );
  }

  /**
   * One pass over the targets, asking each for the window it is given. Shared
   * by the scheduled job and the backfill so there is one writer, one set of
   * refusals and one coverage recomputation however wide the window is.
   */
  private async ingestFixtures(
    source: { provider: Provider; adapter: ProviderAdapter },
    targets: PollTarget[],
    window: (target: PollTarget) => { from: string; to: string },
  ): Promise<JobReport> {
    const replay = this.sources.kind === 'replay';
    let seen = 0;
    let written = 0;
    const refused: string[] = [];
    const unresolved = new Set<string>();
    const seasons = new Set<string>();

    for (const target of targets) {
      const { from, to } = window(target);
      const result = await source.adapter.listFixtures({
        competitionExternalId: target.competitionExternalId,
        seasonLabel: replay ? REPLAY_QUERY.seasonLabel : target.seasonLabel,
        from,
        to,
      });
      if (!result.ok) {
        refused.push(`${target.seasonLabel}: ${describe(result.error)}`);
        continue;
      }
      seen += result.data.length;
      for (const fixture of result.data) {
        const write = await this.store.saveFixture(source.provider, target, fixture, 'fixtures');
        written += write.changed;
        if (write.seasonId !== undefined) seasons.add(write.seasonId);
        for (const id of write.unresolved) unresolved.add(id);
      }
    }
    // What arrived decides what the season's modules may claim (T-027).
    written += await this.coverage.recomputeMany([...seasons]);
    return this.report('fixtures', source.provider, seen, written, refused, unresolved);
  }

  /**
   * The state of matches that should be under way. Asked for by id, so a
   * provider that answers "everything live right now" is filtered to ours and a
   * match nobody here follows costs nothing.
   */
  live(now: Date = new Date()): Promise<JobReport> {
    return this.track('live', async (source, targets) => {
      const from = new Date(now.getTime() - LIVE_WINDOW_AFTER_MINUTES * 60 * 1000).toISOString();
      const to = new Date(now.getTime() + LIVE_WINDOW_BEFORE_MINUTES * 60 * 1000).toISOString();
      let seen = 0;
      let written = 0;
      const refused: string[] = [];
      const unresolved = new Set<string>();
      const seasons = new Set<string>();

      const known: { target: PollTarget; externalIds: string[] }[] = [];
      for (const target of targets) {
        const ids = await this.store.fixtureExternalIds(
          source.provider,
          target.competitionId,
          from,
          to,
        );
        known.push({ target, externalIds: ids.map((k) => k.externalId) });
      }
      const question = liveQuestion(known);

      if (question.externalIds.length > 0) {
        const result = await source.adapter.getLive({ fixtureExternalIds: question.externalIds });
        if (!result.ok) {
          refused.push(`${question.seasonLabels.join(', ')}: ${describe(result.error)}`);
        } else {
          seen += result.data.length;
          for (const fixture of result.data) {
            const target = question.targetOf.get(fixture.externalId);
            if (target === undefined) continue;
            const write = await this.store.saveFixture(source.provider, target, fixture, 'live');
            written += write.changed;
            if (write.seasonId !== undefined) seasons.add(write.seasonId);
            for (const id of write.unresolved) unresolved.add(id);
          }
        }
      }
      written += await this.coverage.recomputeMany([...seasons]);
      return this.report('live', source.provider, seen, written, refused, unresolved);
    });
  }

  /**
   * Announced line-ups for matches about to start, or just started -- and, for
   * the next three days' matches, who the provider says will miss them (T-103).
   */
  lineups(now: Date = new Date()): Promise<JobReport> {
    return this.track('lineups', async (source, targets) => {
      const candidates = await this.detailCandidates(source.provider, targets, now, [
        'scheduled',
        'live',
      ]);
      let seen = 0;
      let written = 0;
      const refused: string[] = [];
      const unresolved = new Set<string>();

      for (const candidate of candidates) {
        const result = await source.adapter.getLineup(candidate.externalId);
        if (!result.ok) {
          refused.push(`${candidate.externalId}: ${describe(result.error)}`);
          continue;
        }
        seen += 1;
        const write = await this.store.saveLineup(
          source.provider,
          candidate.fixtureId,
          result.data,
        );
        written += write.changed;
        for (const id of write.unresolved) unresolved.add(id);
      }

      const asked: string[] = [];
      for (const due of await this.availabilityDue(source, targets, now)) {
        const result = await source.adapter.getAvailability(due.externalId);
        if (!result.ok) {
          // A provider that does not report availability says so every time;
          // that is its answer, not a failure of this run.
          if (result.error.kind === 'unsupported') break;
          refused.push(`${due.externalId}: ${describe(result.error)}`);
          continue;
        }
        seen += 1;
        asked.push(due.fixtureId);
        const write = await this.store.saveAvailability(
          source.provider,
          due.fixtureId,
          result.data,
        );
        written += write.changed;
        for (const id of write.unresolved) unresolved.add(id);
      }

      written += await this.coverage.recomputeMany(
        await this.coverage.seasonsOf([...candidates.map((c) => c.fixtureId), ...asked]),
      );
      return this.report('lineups', source.provider, seen, written, refused, unresolved);
    });
  }

  /**
   * Everything after the whistle: incidents, team statistics, the periods and
   * the closing scores. Runs against matches that have finished recently, and
   * then against finished matches whose detail was never asked for (T-102) --
   * a season backfill writes the fixture list and nothing after the whistle.
   */
  postMatch(now: Date = new Date()): Promise<JobReport> {
    return this.track('post_match', async (source, targets) => {
      const recent = await this.detailCandidates(source.provider, targets, now, [
        'finished',
        'live',
      ]);
      const candidates = [...recent, ...(await this.detailBacklog(source, targets, now, recent))];
      let seen = 0;
      let written = 0;
      const refused: string[] = [];
      const unresolved = new Set<string>();

      for (const candidate of candidates) {
        const result = await source.adapter.getFixtureDetail(candidate.externalId);
        if (!result.ok) {
          refused.push(`${candidate.externalId}: ${describe(result.error)}`);
          continue;
        }
        seen += 1;
        await this.store.markDetailFetched(source.provider, candidate.fixtureId);
        const detail = result.data;
        const writes: WriteResult[] = [
          await this.store.saveFixture(
            source.provider,
            candidate.target,
            detail.fixture,
            'post_match',
          ),
          await this.store.savePeriods(candidate.fixtureId, detail.periods),
          await this.store.saveIncidents(source.provider, candidate.fixtureId, detail.incidents),
          await this.store.saveStatistics(candidate.fixtureId, detail.statistics),
        ];
        if (detail.lineup !== null) {
          writes.push(
            await this.store.saveLineup(source.provider, candidate.fixtureId, detail.lineup),
          );
        }
        if (detail.playerStatistics !== null) {
          writes.push(
            await this.store.savePlayerStatistics(
              source.provider,
              candidate.fixtureId,
              detail.playerStatistics,
            ),
          );
        }
        for (const write of writes) {
          written += write.changed;
          for (const id of write.unresolved) unresolved.add(id);
        }
      }
      written += await this.coverage.recomputeMany(
        await this.coverage.seasonsOf(candidates.map((c) => c.fixtureId)),
      );
      return this.report('post_match', source.provider, seen, written, refused, unresolved);
    });
  }

  /**
   * The provider's table, read as a check on ours.
   *
   * Nothing is written: the table is derived from results (D-038), so there is
   * no standings table to fill. What the provider's table is good for is
   * catching a hole — a team whose played count here is behind the provider's
   * has a fixture we have not ingested. Disagreements make the run `partial`
   * and name the teams, which is how a silent gap becomes a visible one.
   */
  private standingsCheck(now: Date = new Date()): Promise<JobReport> {
    void now;
    return this.track('standings', async (source, targets) => {
      let seen = 0;
      const refused: string[] = [];
      const behind: string[] = [];

      for (const target of targets) {
        const result: AdapterResult<NormalisedStanding[]> = await source.adapter.getStandings({
          competitionExternalId: target.competitionExternalId,
          seasonLabel:
            this.sources.kind === 'replay' ? REPLAY_QUERY.seasonLabel : target.seasonLabel,
        });
        if (!result.ok) {
          refused.push(`${target.seasonLabel}: ${describe(result.error)}`);
          continue;
        }
        let unmapped = 0;

        for (const table of result.data) {
          seen += table.rows.length;
          // Compare the edition the provider's table is for, not the one the
          // poll started from — the same rule `saveFixture` follows.
          const seasonId = await this.store.seasonId(target, table.seasonLabel);
          if (seasonId === null) {
            behind.push(`${table.seasonLabel}: the provider has a table for a season we do not`);
            continue;
          }
          const ours = await this.standings.table(seasonId);
          // Matched through `provider_mapping`, never by the provider's spelling
          // of a club (rule 1). A team nobody has identified is counted, not
          // silently dropped — it is the same gap seen from the other end.
          const mine = new Map((ours.data ?? []).map((row) => [row.team.id, row]));

          for (const row of table.rows) {
            const teamId = await this.store.resolveTeam(source.provider, row.team);
            if (teamId === null) {
              unmapped += 1;
              continue;
            }
            const gap = tableGap(row.team.name, row.played, mine.get(teamId)?.played);
            if (gap !== null) behind.push(gap);
          }
        }
        if (unmapped > 0) {
          behind.push(`${unmapped} teams in the provider's table have no mapping`);
        }
      }
      const partial = [...refused, ...behind].join('; ');
      return {
        job: 'standings' as const,
        provider: source.provider,
        itemsSeen: seen,
        itemsWritten: 0,
        ...(partial === '' ? {} : { partial }),
      };
    });
  }

  /** The fixtures a detail job should spend requests on, newest kick-off first. */
  private async detailCandidates(
    provider: Provider,
    targets: PollTarget[],
    now: Date,
    statuses: string[],
  ): Promise<{ externalId: string; fixtureId: string; target: PollTarget }[]> {
    const from = new Date(now.getTime() - LIVE_WINDOW_AFTER_MINUTES * 60 * 1000).toISOString();
    const to = new Date(now.getTime() + LIVE_WINDOW_BEFORE_MINUTES * 60 * 1000).toISOString();
    const out: { externalId: string; fixtureId: string; target: PollTarget }[] = [];

    for (const target of targets) {
      const known = await this.store.fixtureExternalIds(provider, target.competitionId, from, to);
      for (const fixture of known) {
        if (!statuses.includes(fixture.status)) continue;
        out.push({ externalId: fixture.externalId, fixtureId: fixture.fixtureId, target });
      }
    }
    return out.slice(0, DETAIL_BATCH);
  }

  /**
   * Finished fixtures of the polled seasons whose detail was never asked for,
   * newest first, older than the window the recent sweep covers. The span is
   * the season's own, or the recordings' on the replay source, as for a
   * backfill.
   */
  private async detailBacklog(
    source: JobSource,
    targets: PollTarget[],
    now: Date,
    recent: { fixtureId: string }[],
  ): Promise<{ externalId: string; fixtureId: string; target: PollTarget }[]> {
    const replay = this.sources.kind === 'replay';
    const before = new Date(now.getTime() - LIVE_WINDOW_AFTER_MINUTES * 60 * 1000).toISOString();
    const taken = new Set(recent.map((c) => c.fixtureId));
    const found: {
      externalId: string;
      fixtureId: string;
      kickoffAt: string;
      target: PollTarget;
    }[] = [];
    for (const target of targets) {
      const rows = await this.store.detailBacklog(
        source.provider,
        target.competitionId,
        replay ? REPLAY_QUERY.from : target.seasonStart,
        before,
        this.backlogBatch,
      );
      for (const row of rows) {
        if (!taken.has(row.fixtureId)) found.push({ ...row, target });
      }
    }
    return found
      .sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt))
      .slice(0, this.backlogBatch)
      .map(({ externalId, fixtureId, target }) => ({ externalId, fixtureId, target }));
  }

  /** The polled competitions' matches that are owed a fresh availability answer. */
  private async availabilityDue(
    source: JobSource,
    targets: PollTarget[],
    now: Date,
  ): Promise<{ externalId: string; fixtureId: string }[]> {
    const hours = (n: number) => new Date(now.getTime() + n * 60 * 60 * 1000).toISOString();
    const out: { externalId: string; fixtureId: string }[] = [];
    for (const target of targets) {
      if (out.length >= AVAILABILITY_BATCH) break;
      out.push(
        ...(await this.store.availabilityDue(
          source.provider,
          target.competitionId,
          now.toISOString(),
          hours(AVAILABILITY_WINDOW_HOURS),
          hours(-AVAILABILITY_STALE_HOURS),
          AVAILABILITY_BATCH - out.length,
        )),
      );
    }
    return out;
  }

  private report(
    job: IngestJob,
    provider: Provider,
    seen: number,
    written: number,
    refused: string[],
    unresolved: Set<string>,
  ): JobReport {
    const notes = [...refused];
    if (unresolved.size > 0) {
      notes.push(`${unresolved.size} provider ids have no mapping and are queued for review`);
    }
    const partial = notes.join('; ');
    return {
      job,
      provider,
      itemsSeen: seen,
      itemsWritten: written,
      ...(partial === '' ? {} : { partial }),
    };
  }

  /**
   * Opens the run record, finds what this provider can be polled for, and hands
   * both to the job body. A job with no configured source, or with nothing
   * mapped to poll, still records a run: "it did not run" is information.
   */
  private async track(
    job: IngestJob,
    work: (
      source: { provider: Provider; adapter: ProviderAdapter },
      targets: PollTarget[],
    ) => Promise<JobReport>,
    scope: string | null = null,
    seasonLabel: string | null = null,
  ): Promise<JobReport> {
    const source = this.sources.forJob(job);
    if (source === null) {
      // No run row: `ingest_run.provider` is one of the three real providers,
      // and a run that never happened must not be recorded. The log is where a
      // skipped job is visible.
      const reason = this.sources.reason ?? `no source serves ${job}`;
      this.log.warn(`ingestion job skipped: ${job}`, { event: 'ingest.no_source', job, reason });
      return { job, provider: null, itemsSeen: 0, itemsWritten: 0, partial: reason };
    }

    try {
      return await this.runOne(job, source, work, scope, seasonLabel);
    } catch (error: unknown) {
      // `ingest_run` has a partial unique index on (provider, job) while a run
      // is open, so a second tick of the same job cannot start. That is the
      // lock working; the tick is skipped, not failed.
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        this.log.warn(`ingestion tick skipped, already running: ${job}`, {
          event: 'ingest.already_running',
          job,
          provider: source.provider,
        });
        return {
          job,
          provider: source.provider,
          itemsSeen: 0,
          itemsWritten: 0,
          partial: 'a run of this job was already open',
        };
      }
      throw error;
    }
  }

  private runOne(
    job: IngestJob,
    source: { provider: Provider; adapter: ProviderAdapter },
    work: (
      source: { provider: Provider; adapter: ProviderAdapter },
      targets: PollTarget[],
    ) => Promise<JobReport>,
    scope: string | null,
    seasonLabel: string | null = null,
  ): Promise<JobReport> {
    return this.runs.track(source.provider, job, scope, async () => {
      const targets = await this.store.pollTargets(source.provider, seasonLabel);
      if (targets.length === 0) {
        const reason =
          seasonLabel === null
            ? `no competition is mapped to ${source.provider} with a current season`
            : `no competition mapped to ${source.provider} has a season labelled ${seasonLabel}`;
        const report: JobReport = {
          job,
          provider: source.provider,
          itemsSeen: 0,
          itemsWritten: 0,
          partial: reason,
        };
        return { result: report, itemsSeen: 0, itemsWritten: 0, partial: reason };
      }
      const report = await work(source, targets);
      return {
        result: report,
        itemsSeen: report.itemsSeen,
        itemsWritten: report.itemsWritten,
        ...(report.partial === undefined ? {} : { partial: report.partial }),
      };
    });
  }
}
