import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DATA_QUALITY_CHECKS, type DataQualityCheck } from '@fmip/contracts';
import { DatabaseModule } from '../database/database.module';
import { DataQualityModule } from '../modules/data-quality/data-quality.module';
import {
  DataQualityService,
  type EndedClassRow,
} from '../modules/data-quality/data-quality.service';
import { IdentityModule } from '../modules/identity/identity.module';
import { IdentityService } from '../modules/identity/identity.service';

/**
 * Ended seasons' open data-quality findings reviewed in batches (T-1662),
 * from a terminal on the server:
 *
 *     docker compose run --rm -T api node dist/cli/review-ended-seasons.js \
 *       --by you@your-domain --reason "past seasons' feed data, loaded for training" \
 *       [--check lineup_not_eleven] [--dry-run]
 *
 * Every check with open, unreviewed findings in a season whose end date has
 * passed is marked reviewed through `DataQualityService.reviewBatch` -- one
 * check in one season at a time, each its own audit row naming the findings
 * (T-912, rule 10) -- so the admin page's queue holds the seasons still being
 * played. A finding stays open until the data agrees, and one that comes back
 * after it went away is unreviewed again, as with the page's batch.
 * `--dry-run` lists the batches and marks nothing. `--by` names an
 * administrator, as `backfill.js`.
 */

/** As the admin page's batch (data-quality.controller.ts). */
export const MAX_REASON = 500;

export type ReviewEndedArgs =
  | { by: string; reason: string; check: DataQualityCheck | null; dryRun: boolean }
  | { error: string };

const FLAGS = ['--by', '--reason', '--check'] as const;
type Flag = (typeof FLAGS)[number];
const isFlag = (value: string | undefined): value is Flag =>
  (FLAGS as readonly string[]).includes(value ?? '');
const isCheck = (value: string): value is DataQualityCheck =>
  (DATA_QUALITY_CHECKS as readonly string[]).includes(value);

/** The operator's arguments, or the reason there are none. Pure, for tests. */
export function parseReviewEndedArgs(argv: string[]): ReviewEndedArgs {
  const given: Partial<Record<Flag, string>> = {};
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--dry-run') {
      dryRun = true;
      continue;
    }
    const value = argv[i + 1];
    if (!isFlag(flag)) return { error: `Unknown argument: ${flag}` };
    if (value === undefined || value.startsWith('--')) return { error: `${flag} needs a value.` };
    given[flag] = value.trim();
    i += 1;
  }
  const by = (given['--by'] ?? '').toLowerCase();
  const reason = given['--reason'] ?? '';
  const check = given['--check'] ?? null;
  if (by === '') return { error: '--by is required: the e-mail of an administrator.' };
  if (reason === '') return { error: '--reason is required: why these findings are reviewed.' };
  if (reason.length > MAX_REASON) {
    return { error: `--reason takes at most ${MAX_REASON} characters; it is recorded.` };
  }
  if (check !== null && !isCheck(check)) {
    return { error: `--check takes one of ${DATA_QUALITY_CHECKS.join(', ')}, not "${check}".` };
  }
  return { by, reason, check, dryRun };
}

/** One batch as the command prints it. */
export function describeClass(row: EndedClassRow): string {
  return `${row.competitionName ?? 'no competition'} ${row.seasonLabel}: ${row.check}, ${row.open} open`;
}

@Module({ imports: [DatabaseModule, IdentityModule, DataQualityModule] })
class ReviewEndedCliModule {}

async function main(): Promise<number> {
  const parsed = parseReviewEndedArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(parsed.error);
    console.error(
      'Usage: node dist/cli/review-ended-seasons.js --by <admin e-mail> --reason "<why>"' +
        ' [--check <check>] [--dry-run]',
    );
    return 2;
  }
  process.env.INGESTION_SCHEDULE = 'off';

  const app = await NestFactory.createApplicationContext(ReviewEndedCliModule, {
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
      console.error(`${parsed.by} is not an administrator; the review is recorded as theirs.`);
      return 1;
    }
    const dataQuality = app.get(DataQualityService);
    const classes = (await dataQuality.endedSeasonClasses()).filter(
      (c) => parsed.check === null || c.check === parsed.check,
    );
    let reviewed = 0;
    for (const row of classes) {
      if (parsed.dryRun) {
        process.stdout.write(`${describeClass(row)}\n`);
        continue;
      }
      const count = await dataQuality.reviewBatch(row.check, row.seasonId, user.id, parsed.reason);
      reviewed += count;
      process.stdout.write(`${describeClass(row)} -> ${count} reviewed\n`);
    }
    const total = classes.reduce((sum, c) => sum + c.open, 0);
    process.stdout.write(
      parsed.dryRun
        ? `dry run: ${classes.length} batch(es), ${total} finding(s); nothing marked.\n`
        : `reviewed ${reviewed} finding(s) in ${classes.length} batch(es), one audit row each.\n`,
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
      new Logger('review-ended-seasons').error(
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    },
  );
}
