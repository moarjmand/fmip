import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type {
  BriefingDigest,
  BriefingNotice,
  BriefingOutcome,
  BriefingResponse,
} from '@fmip/contracts';
import { FollowingFeedService } from '../following-feed/following-feed.service';
import { IntelligenceService } from '../intelligence/intelligence.service';
import {
  type CarryReport,
  type DueNotification,
  type EmitOutcome,
  NotificationsService,
  type OutboundMessages,
} from '../notifications/notifications.service';
import { checkBriefing, documentOf } from './internal/briefing-document';
import { PostgresBriefingStore } from './internal/briefing-store';

export const PROMPT_VERSION = 'briefing@3';
const MAX_TOKENS = 900;
/** The title a channel shows; the same words the inbox uses for the kind. */
export const BRIEFING_NOTICE_TITLE = 'Your briefing';
/** Where the notification opens: the Following page, at the briefing (the web adds its locale). */
export const BRIEFING_PATH = '/following#briefing';

/** The standing instruction: stable across every briefing, so the provider can cache it. */
export const BRIEFING_SYSTEM = [
  "You write a short personal briefing for a member of a football website, from a JSON document of what happened around the teams, competitions and people they follow: the days in the window, and on each day the items -- matches with scores, published stories with their headline and publisher, analyses with a stated call, and members' posts -- each with the signals that put it there.",
  'Write in plain English addressed to the member, at a length the document can carry: one short paragraph when it holds one or two items, two to four when it holds more. Every paragraph must be about items in the document, naming them as the document names them; give only numbers the document holds.',
  'Do not predict anything, do not add anything the document does not say, and do not say what the member should think. Do not mention that you are a model or that you were given a document. Output the paragraphs only.',
  // briefing@2, after the first real run (2026-09-19): two of three attempts
  // were turned down by the gate -- one paragraph about what was *absent*
  // from the feed, one carrying a date written as digits. Both are things
  // the model reaches for when the feed is thin, and both are said plainly.
  //
  // briefing@3, after a second run (2026-09-20) in which a one-item feed was
  // turned down four times out of four, every time for a paragraph pointing
  // at nothing. Telling the model not to pad while asking it for two to four
  // paragraphs about a single match is asking for two things at once: the
  // length is what forced the padding, so the length now follows the
  // document. The instruction below already said to write about a single item
  // alone; it now has room to.
  'Write only about the items listed, in the words the document uses for them. Do not mention what is absent, missing or not logged, and do not describe the window itself. Do not write dates, times or years as numbers; say "yesterday" or "on Sunday" instead. If there is a single item, write about that item alone.',
].join(' ');

/**
 * Briefings (E43): the feed's window as a document (T-430), a machine's
 * prose over it (T-431) that the gate holds to the document, and the prose
 * as a notification (T-432). A version is written when the member asks,
 * never on a page load, so a page never waits for a model; with no model
 * the document is the briefing, and the page says so in a sentence.
 *
 * **The notification is the inbox's, not a second one.** A published
 * briefing is emitted like any other kind, so the member's preference, their
 * quiet hours and the one-per-window rule are the inbox's own, and it leaves
 * the building through the inbox's carrier, with this module's own words for
 * it -- the prose by e-mail, its first paragraph as a push (T-330). "The same window" is the member's day: the key is the date the
 * feed's window starts on, so asking twice in a day writes two versions and
 * tells them once.
 */
@Injectable()
export class BriefingsService implements OnModuleInit {
  private readonly log = new Logger('Briefings');

  constructor(
    private readonly store: PostgresBriefingStore,
    private readonly feeds: FollowingFeedService,
    private readonly intelligence: IntelligenceService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The carrier's words for a briefing are this module's: the prose, not the inbox's one line. */
  onModuleInit(): void {
    this.notifications.registerComposer('briefing', (due) => this.compose(due));
  }

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
    const { id, number } = await this.store.add({
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
    if (rejection !== null) return { outcome: 'rejected', version_number: number, rejection };

    const notification = noticeOf(
      await this.notifications.emit({
        userId,
        kind: 'briefing',
        subjectType: 'briefing',
        subjectId: id,
        dedupeKey: windowKey(document),
      }),
    );
    // Carried now if nothing holds it; a held one leaves when the hold ends.
    if (notification === 'sent') await this.carry(userId);
    return { outcome: 'published', version_number: number, rejection: null, notification };
  }

  /** Carries what is due through the inbox's carrier, now rather than on its next pass (T-432). */
  carry(userId?: string): Promise<CarryReport> {
    return this.notifications.carry(userId === undefined ? undefined : { userIds: [userId] });
  }

  /**
   * The messages for one due notification: the prose itself by e-mail, and
   * its first paragraph as a push that opens the Following page. A briefing
   * that is no longer there, or is not this member's, is carried as nothing.
   */
  private async compose(due: DueNotification): Promise<OutboundMessages | null> {
    const briefing = await this.store.published(due.subject_id);
    if (briefing === null || briefing.user_id !== due.user_id) return null;
    return {
      email: { to: due.email, subject: BRIEFING_NOTICE_TITLE, text: briefing.text },
      push: {
        userId: due.user_id,
        title: BRIEFING_NOTICE_TITLE,
        body: firstParagraph(briefing.text),
        url: BRIEFING_PATH,
      },
    };
  }
}

/** One notification per member per day: the date the feed's window starts on. */
export function windowKey(document: Pick<BriefingDigest, 'since'>): string {
  return document.since.slice(0, 10);
}

/** The inbox's outcome in the briefing's words; capped and blocked cannot happen to a sourceless, uncapped kind. */
function noticeOf(outcome: EmitOutcome): BriefingNotice {
  switch (outcome) {
    case 'sent':
    case 'delayed':
    case 'duplicate':
    case 'muted':
      return outcome;
    default:
      return 'failed';
  }
}

function firstParagraph(text: string): string {
  return text.split(/\n{2,}/)[0]?.trim() ?? text;
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
