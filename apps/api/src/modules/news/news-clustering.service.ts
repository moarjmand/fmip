import { Injectable, Logger } from '@nestjs/common';
import { PostgresNewsStore } from './internal/news-store';

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
 * never a person and never a guess (rules 1 and 3). Clustering is narrower
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
