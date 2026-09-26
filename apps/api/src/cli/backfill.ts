import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { IdentityModule } from '../modules/identity/identity.module';
import { IdentityService } from '../modules/identity/identity.service';
import { IngestRunsService } from '../modules/ingestion/ingest-runs.service';
import { IngestionJobsService } from '../modules/ingestion/ingestion-jobs.service';
import { IngestionModule } from '../modules/ingestion/ingestion.module';

/**
 * The season backfill (T-030) from a terminal on the server (T-502).
 *
 *     docker compose run --rm -T api node dist/cli/backfill.js \
 *       --by you@your-domain --reason "six new leagues added"
 *
 * `--season 2025/26` reads that season instead of the current one, for every
 * competition the catalogue holds it for: a past season added with
 * `catalog.mjs --add-season` (not `--current`) so the model can learn from it
 * (T-512, D-083).
 *
 * The admin page's button is the same act and stays the way in from a
 * browser. This is for the operator who is already on the server, adding a
 * competition with `catalog.mjs` and needing its season before the table can
 * be right -- the same place, the same rules as that tool: it names an
 * administrator with `--by`, asks why, records both in the audit log before a
 * request is spent (rule 10), and appears in `ingest_run` like the button's
 * run. It never polls: this process sets `INGESTION_SCHEDULE=off` for itself,
 * so the running API stays the only scheduler.
 */

export const MAX_REASON = 300;

export type BackfillArgs =
  { by: string; reason: string; season: string | null } | { error: string };

/** A season label as the catalogue writes it: `2025/26`. */
const SEASON_LABEL = /^\d{4}\/\d{2}$/;

/** The operator's arguments, or the reason there are none. Pure, for tests. */
export function parseBackfillArgs(argv: string[]): BackfillArgs {
  let by = '';
  let reason = '';
  let season: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag !== '--by' && flag !== '--reason' && flag !== '--season') {
      return { error: `Unknown argument: ${flag}` };
    }
    if (value === undefined || value.startsWith('--')) return { error: `${flag} needs a value.` };
    if (flag === '--by') by = value.trim().toLowerCase();
    else if (flag === '--reason') reason = value.trim();
    else season = value.trim();
    i += 1;
  }
  if (by === '') return { error: '--by is required: the e-mail of an administrator.' };
  if (reason === '') return { error: '--reason is required: why the seasons are backfilled.' };
  if (season !== null && !SEASON_LABEL.test(season)) {
    return { error: `--season takes a label such as 2025/26, not "${season}".` };
  }
  return { by, reason: reason.slice(0, MAX_REASON), season };
}

@Module({ imports: [DatabaseModule, IdentityModule, IngestionModule] })
class BackfillModule {}

async function main(): Promise<number> {
  const parsed = parseBackfillArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(parsed.error);
    console.error(
      'Usage: node dist/cli/backfill.js --by <admin e-mail> --reason "<why>" [--season 2025/26]',
    );
    return 2;
  }
  process.env.INGESTION_SCHEDULE = 'off';

  const app = await NestFactory.createApplicationContext(BackfillModule, {
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
      console.error(`${parsed.by} is not an administrator; a backfill is recorded as theirs.`);
      return 1;
    }
    await app.get(IngestRunsService).auditBackfill(user.id, parsed.reason, parsed.season);
    const report = await app.get(IngestionJobsService).backfill(new Date(), parsed.season);
    process.stdout.write(
      `backfill ${report.partial === undefined ? 'succeeded' : 'partial'}: ` +
        `${report.itemsSeen} fixture(s) seen, ${report.itemsWritten} row(s) written` +
        (report.partial === undefined ? '.\n' : `\n  ${report.partial}\n`),
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
      new Logger('backfill').error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
