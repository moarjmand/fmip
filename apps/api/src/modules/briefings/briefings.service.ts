import { Injectable, Logger } from '@nestjs/common';
import type { BriefingDigest, BriefingOutcome, BriefingResponse } from '@fmip/contracts';
import { FollowingFeedService } from '../following-feed/following-feed.service';
import { IntelligenceService } from '../intelligence/intelligence.service';
import { checkBriefing, documentOf } from './internal/briefing-document';
import { PostgresBriefingStore } from './internal/briefing-store';

export const PROMPT_VERSION = 'briefing@1';
const MAX_TOKENS = 900;

/** The standing instruction: stable across every briefing, so the provider can cache it. */
export const BRIEFING_SYSTEM = [
  "You write a short personal briefing for a member of a football website, from a JSON document of what happened around the teams, competitions and people they follow: the days in the window, and on each day the items -- matches with scores, published stories with their headline and publisher, analyses with a stated call, and members' posts -- each with the signals that put it there.",
  'Write two to four short paragraphs in plain English addressed to the member. Every paragraph must be about items in the document, naming them as the document names them; give only numbers the document holds.',
  'Do not predict anything, do not add anything the document does not say, and do not say what the member should think. Do not mention that you are a model or that you were given a document. Output the paragraphs only.',
].join(' ');

/**
 * Briefings (E43): the feed's window as a document (T-430), and a machine's
 * prose over it (T-431) that the gate holds to the document. A version is
 * written when the member asks, never on a page load, so a page never waits
 * for a model; with no model the document is the briefing, and the page
 * says so in a sentence.
 */
@Injectable()
export class BriefingsService {
  private readonly log = new Logger('Briefings');

  constructor(
    private readonly store: PostgresBriefingStore,
    private readonly feeds: FollowingFeedService,
    private readonly intelligence: IntelligenceService,
  ) {}

  async current(userId: string): Promise<BriefingResponse> {
    const [feed, published, versions] = await Promise.all([
      this.feeds.feed(userId),
      this.store.latestPublished(userId),
      this.store.versions(userId),
    ]);
    const document = documentOf(feed);
    if (published !== null) {
      return {
        digest: document,
        prose: {
          coverage: 'available',
          last_updated_at: published.generated_at.toISOString(),
          data: {
            text: published.text,
            language: published.language,
            model: published.model,
            prompt_version: published.prompt_version,
            generated_at: published.generated_at.toISOString(),
            version_number: published.version_number,
            since: published.since.toISOString(),
            until: published.until.toISOString(),
          },
        },
        reason: null,
        versions,
      };
    }
    const reason = this.intelligence.describe().absent
      ? 'no_model'
      : feed.items.length === 0
        ? 'nothing_to_brief'
        : versions > 0
          ? 'rejected'
          : 'not_written';
    return {
      digest: document,
      prose: { coverage: 'not_supplied', last_updated_at: null, data: null },
      reason,
      versions,
    };
  }

  async write(userId: string): Promise<BriefingOutcome> {
    const feed = await this.feeds.feed(userId);
    if (feed.items.length === 0) return { outcome: 'nothing_to_brief' };
    const document = documentOf(feed);
    const answer = await this.intelligence.complete({
      system: BRIEFING_SYSTEM,
      prompt: JSON.stringify(document),
      maxTokens: MAX_TOKENS,
    });
    if (answer.outcome === 'absent') return { outcome: 'absent' };
    if (answer.outcome === 'failed') return { outcome: 'failed' };
    const { completion } = answer;
    const rejection = rejectionOf(completion.stop, completion.text, document);
    const state = rejection === null ? 'published' : 'rejected';
    const number = await this.store.add({
      userId,
      since: document.since,
      until: document.until,
      state,
      text: completion.text === '' ? null : completion.text,
      rejection,
      document,
      promptVersion: PROMPT_VERSION,
      model: completion.model,
    });
    this.log.log(`briefing ${state} version=${number}`, {
      event: `briefing.${state}`,
      version_number: number,
      model: completion.model,
      rejection,
    });
    return { outcome: state, version_number: number, rejection };
  }
}

function rejectionOf(
  stop: 'end_turn' | 'max_tokens' | 'refusal' | 'other',
  text: string,
  document: BriefingDigest,
): string | null {
  if (stop === 'refusal') return 'the model refused';
  if (stop === 'max_tokens') return 'the answer was cut off';
  if (stop === 'other') return 'the model stopped for another reason';
  const grounding = checkBriefing(text, document);
  return grounding.ok ? null : grounding.reason;
}
