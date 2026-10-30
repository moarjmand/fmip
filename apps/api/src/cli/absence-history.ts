import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { IdentityModule } from '../modules/identity/identity.module';
import { IdentityService } from '../modules/identity/identity.service';
import {
  AbsenceHistoryService,
  absenceHistoryTotals,
  describeLine,
  type AbsenceHistoryFilter,
} from '../modules/ingestion/absence-history.service';
import { IngestionModule } from '../modules/ingestion/ingestion.module';

/**
 * Past seasons' absences for the training store (T-1650, D-306), from a
 * terminal on the server:
 *
 *     docker compose run --rm -T api node dist/cli/absence-history.js \
 *       --by you@your-domain --reason "absences for the model factors" \
 *       [--season 2023/24] [--competition 39]
 *
 * Each past season from 2021/22 on of every competition we hold -- the ones
 * kept out of the training store included (D-304) -- is asked once
 * (`/injuries?league=&season=`) and written into `absence_history`, which
 * nothing on the site reads. `--season` and `--competition` (the provider's
 * id) narrow the run. Running it again rewrites the same rows, and gives a
 * player mapped since his person id.
 *
 * As `backfill.js`: `--by` names an administrator, the reason is audited
 * before a request is spent (rule 10), the run is an `ingest_run` row
 * counted in the day's budget, and this process never polls
 * (`INGESTION_SCHEDULE=off` for itself).
 */

export const MAX_REASON = 300;

export type AbsenceHistoryArgs =
  ({ by: string; reason: string } & AbsenceHistoryFilter) | { error: string };

/** A season label as the catalogue writes it: `2023/24`, or `2023` for a calendar season. */
const SEASON_LABEL = /^\d{4}(\/\d{2})?$/;
/** The provider's competition id. */
const PROVIDER_ID = /^\d+$/;

const FLAGS = ['--by', '--reason', '--season', '--competition'] as const;
type Flag = (typeof FLAGS)[number];
const isFlag = (value: string | undefined): value is Flag =>
  (FLAGS as readonly string[]).includes(value ?? '');

/** The operator's arguments, or the reason there are none. Pure, for tests. */
export function parseAbsenceHistoryArgs(argv: string[]): AbsenceHistoryArgs {
  const given: Partial<Record<Flag, string>> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!isFlag(flag)) return { error: `Unknown argument: ${flag}` };
    if (value === undefined || value.startsWith('--')) return { error: `${flag} needs a value.` };
    given[flag] = value.trim();
  }
  const by = (given['--by'] ?? '').toLowerCase();
  const reason = given['--reason'] ?? '';
  const season = given['--season'] ?? null;
  const competition = given['--competition'] ?? null;
  if (by === '') return { error: '--by is required: the e-mail of an administrator.' };
  if (reason === '') return { error: '--reason is required: why the history is fetched.' };
  if (season !== null && !SEASON_LABEL.test(season)) {
    return { error: `--season takes a label such as 2023/24, not "${season}".` };
  }
  if (competition !== null && !PROVIDER_ID.test(competition)) {
    return {
      error: `--competition takes the provider's competition id, such as 39, not "${competition}".`,
    };
  }
  return {
    by,
    reason: reason.slice(0, MAX_REASON),
    seasonLabel: season,
    competitionExternalId: competition,
  };
}

@Module({ imports: [DatabaseModule, IdentityModule, IngestionModule] })
class AbsenceHistoryCliModule {}

async function main(): Promise<number> {
  const parsed = parseAbsenceHistoryArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(parsed.error);
    console.error(
      'Usage: node dist/cli/absence-history.js --by <admin e-mail> --reason "<why>"' +
        ' [--season 2023/24] [--competition <provider id>]',
    );
    return 2;
  }
  process.env.INGESTION_SCHEDULE = 'off';

  const app = await NestFactory.createApplicationContext(AbsenceHistoryCliModule, {
    logger: ['error', 'warn'],
  });
  try {
    const identity = app.get(IdentityService);
    const user = await identity.userByEmail(parsed.by);
    if (user === null) {
      console.error(`No active account with the e-mail ${parsed.by}.`);
      return 1;
    }
    if (!(await identity.hasRole(user.id, 'admin'))) {
      console.error(`${parsed.by} is not an administrator; the run is recorded as theirs.`);
      return 1;
    }
    const filter: AbsenceHistoryFilter = {
      seasonLabel: parsed.seasonLabel,
      competitionExternalId: parsed.competitionExternalId,
    };
    const history = app.get(AbsenceHistoryService);
    await history.audit(user.id, parsed.reason, filter);
    const sweep = await history.run(filter, (line) => {
      process.stdout.write(`${describeLine(line)}\n`);
    });
    if ('error' in sweep) {
      console.error(`absence history not run: ${sweep.error}`);
      return 1;
    }
    const t = absenceHistoryTotals(sweep.lines);
    process.stdout.write(
      `absence history ${sweep.stopped === undefined ? 'done' : 'partial'}: ` +
        `${t.seasons} season(s) answered, ${sweep.asked} request(s), ` +
        `${t.entries} listed, ${t.written} row(s) written; ` +
        `${t.skipped} skipped (${t.fixturesUnmapped} matches we do not hold, or a club we do not hold); ` +
        `${t.personsUnmapped} player(s) kept by the provider's id; ` +
        `${sweep.relinked} earlier row(s) given a person id.\n` +
        (sweep.stopped === undefined ? '' : `  ${sweep.stopped}\n`),
    );
    return 0;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      new Logger('absence-history').error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
