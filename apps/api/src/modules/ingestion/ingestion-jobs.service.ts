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
 */
export const DETAIL_BACKLOG_BATCH = 20;

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

/** The earlier of two `YYYY-MM-DD` days; they sort as they read. */
function earlier(a: string, b: string): string {
  return a < b ? a : b;
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
@Injectable()
export class IngestionJobsService {
  private readonly log = new Logger('Ingestion');
  private readonly store: IngestStore;

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
    return this.track('fixtures', (source, targets) => {
      const replay = this.sources.kind === 'replay';
      const from = replay ? REPLAY_QUERY.from : dayIso(now, -FIXTURE_WINDOW_BACK_DAYS);
      const to = replay ? REPLAY_QUERY.to : dayIso(now, FIXTURE_WINDOW_FORWARD_DAYS);
      return this.ingestFixtures(source, targets, () => ({ from, to }));
    });
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
   */
  backfill(now: Date = new Date()): Promise<JobReport> {
    return this.track(
      'fixtures',
      (source, targets) => {
        const replay = this.sources.kind === 'replay';
        return this.ingestFixtures(source, targets, (target) =>
          replay
            ? { from: REPLAY_QUERY.from, to: REPLAY_QUERY.to }
            : {
                from: target.seasonStart,
                // Never past today: a season's later half has not happened, and
                // asking for it spends a request to be told so.
                to: earlier(dayIso(now, FIXTURE_WINDOW_FORWARD_DAYS), target.seasonEnd),
              },
        );
      },
      'backfill',
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

      for (const target of targets) {
        const known = await this.store.fixtureExternalIds(
          source.provider,
          target.competitionId,
          from,
          to,
        );
        if (known.length === 0) continue;

        const result = await source.adapter.getLive({
          fixtureExternalIds: known.map((k) => k.externalId),
        });
        if (!result.ok) {
          refused.push(`${target.seasonLabel}: ${describe(result.error)}`);
          continue;
        }
        seen += result.data.length;
        for (const fixture of result.data) {
          const write = await this.store.saveFixture(source.provider, target, fixture, 'live');
          written += write.changed;
          if (write.seasonId !== undefined) seasons.add(write.seasonId);
          for (const id of write.unresolved) unresolved.add(id);
        }
      }
      written += await this.coverage.recomputeMany([...seasons]);
      return this.report('live', source.provider, seen, written, refused, unresolved);
    });
  }

  /** Announced line-ups for matches about to start, or just started. */
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
      written += await this.coverage.recomputeMany(
        await this.coverage.seasonsOf(candidates.map((c) => c.fixtureId)),
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
            const held = mine.get(teamId);
            if (held === undefined) {
              behind.push(`${row.team.name}: provider ${row.played} played, we hold no table row`);
            } else if (held.played !== row.played) {
              behind.push(
                `${row.team.name}: provider ${row.played} played, we have ${held.played}`,
              );
            }
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
        DETAIL_BACKLOG_BATCH,
      );
      for (const row of rows) {
        if (!taken.has(row.fixtureId)) found.push({ ...row, target });
      }
    }
    return found
      .sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt))
      .slice(0, DETAIL_BACKLOG_BATCH)
      .map(({ externalId, fixtureId, target }) => ({ externalId, fixtureId, target }));
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
      return await this.runOne(job, source, work, scope);
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
  ): Promise<JobReport> {
    return this.runs.track(source.provider, job, scope, async () => {
      const targets = await this.store.pollTargets(source.provider);
      if (targets.length === 0) {
        const reason = `no competition is mapped to ${source.provider} with a current season`;
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
