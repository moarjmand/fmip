import { Injectable, Logger } from '@nestjs/common';
import { PostgresNewsStore, type PersonCandidate } from './internal/news-store';

/**
 * A name or alias shorter than this after folding ("roma", "ajax", "psg")
 * is a word a headline can carry without meaning the club; below it nothing
 * is linked, and the alias table is where a longer form belongs.
 */
export const MINIMUM_NAME_LENGTH = 5;
/** A report published within two days of kick-off, naming both teams, is about that match. */
export const FIXTURE_WINDOW = '48 hours';
/** Two publishers' reports of one event arrive within two days of each other. */
export const DUPLICATE_WINDOW = '48 hours';
/**
 * Trigram similarity of two headlines once the linked names are removed.
 * Calibrated on 2026-09-18 against pairs written for the purpose: reports
 * that are the same story reworded ("Saka strikes late to sink Blues" /
 * "Saka strikes late as Gunners sink Blues") score 0.55-0.68; independent
 * write-ups of one match ("beat 2-1 at the Emirates" / "slump to 2-1 defeat")
 * score 0.24-0.31 and stay apart, which is the conservative side; different
 * events about the same two teams ("late winner" / "sack manager after
 * defeat") score at most 0.09. The names had to come out first: with them in,
 * the last pair scored 0.52.
 */
export const DUPLICATE_THRESHOLD = 0.4;

/**
 * Whether the clustering links persons (T-1006, D-126): `NEWS_PERSON_LINKS=on`,
 * and off for anything else. It stays off until the rule's precision on a
 * hand-checked sample of stored headlines (`dist/cli/person-link-sample.js`)
 * is recorded in D-126 at or above `PERSON_LINK_PRECISION_BAR`.
 */
export function personLinksOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NEWS_PERSON_LINKS?.trim().toLowerCase() === 'on';
}

/** The share of sampled links a person must judge right before the rule may write (D-126). */
export const PERSON_LINK_PRECISION_BAR = 0.95;
/** The fewest proposed links a sample must hold for its precision to count (D-126). */
export const PERSON_LINK_SAMPLE_MINIMUM = 100;

export interface Placement {
  /** How many entities the article links after this pass. */
  linked: number;
  /** `joined` when the article was moved into another publisher's story. */
  story: 'own' | 'joined' | 'kept';
  storyId: string;
}

/**
 * Where a report belongs (T-142, blueprint 3.3): which entities it is about,
 * and whether it is another publisher's telling of a story already here.
 *
 * Linking is by the entity's own name or a recorded alias, whole words only,
 * never a guess (rules 1 and 3). A person is linked only behind
 * `NEWS_PERSON_LINKS` and only by the narrower rule of D-126. Clustering is narrower
 * than it could be on purpose: two reports become one story only when they
 * link exactly the same teams, come from different publishers, fall within
 * the window and still read alike once the names are taken out. A duplicate
 * left apart costs a reader one repeated headline; a story wrongly merged
 * hides a report behind another publisher's original.
 */
@Injectable()
export class NewsClusteringService {
  private readonly log = new Logger('News');

  constructor(private readonly store: PostgresNewsStore) {}

  /** What the person rule would link to an article, written nowhere (the precision sample). */
  personCandidates(articleId: string): Promise<PersonCandidate[]> {
    return this.store.personCandidates(articleId, MINIMUM_NAME_LENGTH);
  }

  /** A random sample of stored articles that link a team, for the precision check. */
  sampleArticles(
    size: number,
  ): Promise<{ id: string; headline: string; summary: string | null }[]> {
    return this.store.samplePersonArticles(size);
  }

  /**
   * Links the article's entities from every version it has, then -- for a
   * report seen for the first time -- looks for the story it duplicates. An
   * article seen before keeps its story: a corrected headline is a new
   * version of the same report, not a new report.
   */
  async place(articleId: string, firstSeen: boolean): Promise<Placement> {
    const linked = await this.store.linkEntities(articleId, {
      minimumKeyLength: MINIMUM_NAME_LENGTH,
      fixtureWindow: FIXTURE_WINDOW,
      persons: personLinksOn(),
    });
    if (!firstSeen) {
      return { linked, story: 'kept', storyId: await this.store.storyOf(articleId) };
    }
    const duplicate = await this.store.duplicateOf(articleId, {
      window: DUPLICATE_WINDOW,
      threshold: DUPLICATE_THRESHOLD,
    });
    if (duplicate === null) {
      const storyId = await this.store.storyOf(articleId);
      await this.store.promoteOriginal(storyId);
      return { linked, story: 'own', storyId };
    }
    await this.store.moveToStory(articleId, duplicate.storyId);
    this.log.log('news report joined a story', {
      event: 'news.clustered',
      article: articleId,
      story: duplicate.storyId,
      score: duplicate.score,
    });
    return { linked, story: 'joined', storyId: duplicate.storyId };
  }
}
