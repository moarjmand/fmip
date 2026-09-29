import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import {
  NewsClusteringService,
  PERSON_LINK_PRECISION_BAR,
  PERSON_LINK_SAMPLE_MINIMUM,
} from '../modules/news/news-clustering.service';
import { NewsModule } from '../modules/news/news.module';

/**
 * The precision sample for linking persons to stories (T-1006, D-126).
 *
 *     docker compose run --rm -T api node dist/cli/person-link-sample.js --size 300
 *
 * Reads a random sample of stored articles that link a team and prints, one
 * tab-separated row per link the rule would make, the article, the person,
 * the words it matched and the publisher's headline and summary. It writes
 * nothing. A person marks each row right or wrong; precision is right / rows,
 * and the rule may be switched on (`NEWS_PERSON_LINKS=on`) only when that is
 * at least the bar over at least the minimum rows, recorded in D-126.
 */

export const DEFAULT_SIZE = 300;
export const MAX_SIZE = 5000;

export type SampleArgs = { size: number } | { error: string };

/** The operator's arguments, or the reason there are none. Pure, for tests. */
export function parseSampleArgs(argv: string[]): SampleArgs {
  let size = DEFAULT_SIZE;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag !== '--size') return { error: `Unknown argument: ${flag}` };
    const value = argv[i + 1];
    if (value === undefined || !/^\d+$/.test(value))
      return { error: '--size needs a whole number.' };
    size = Number(value);
    if (size < 1 || size > MAX_SIZE) return { error: `--size is between 1 and ${MAX_SIZE}.` };
    i += 1;
  }
  return { size };
}

/** One line of the sheet: tabs and line breaks inside a field become spaces. */
export function sheetRow(fields: (string | null)[]): string {
  return fields.map((f) => (f ?? '').replace(/[\t\r\n]+/g, ' ').trim()).join('\t');
}

@Module({ imports: [DatabaseModule, NewsModule] })
class SampleModule {}

async function main(): Promise<number> {
  const parsed = parseSampleArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(parsed.error);
    console.error('Usage: node dist/cli/person-link-sample.js [--size 300]');
    return 2;
  }
  process.env.INGESTION_SCHEDULE = 'off';
  const app = await NestFactory.createApplicationContext(SampleModule, {
    logger: ['error', 'warn'],
  });
  try {
    const clustering = app.get(NewsClusteringService);
    const articles = await clustering.sampleArticles(parsed.size);
    const out: string[] = [
      sheetRow(['article', 'person', 'matched', 'headline', 'summary', 'right?']),
    ];
    for (const a of articles) {
      for (const c of await clustering.personCandidates(a.id)) {
        out.push(sheetRow([a.id, c.name, c.key, a.headline, (a.summary ?? '').slice(0, 300), '']));
      }
    }
    process.stdout.write(`${out.join('\n')}\n`);
    process.stderr.write(
      `${articles.length} article(s) sampled, ${out.length - 1} link(s) proposed. ` +
        `Mark each row; the rule may write only at a precision of at least ` +
        `${PERSON_LINK_PRECISION_BAR} over at least ${PERSON_LINK_SAMPLE_MINIMUM} rows (D-126).\n`,
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
      new Logger('person-link-sample').error(
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    },
  );
}
