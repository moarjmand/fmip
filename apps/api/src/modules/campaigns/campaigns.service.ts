import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Audience, AudienceFilter, Campaign, CampaignDispatch } from '@fmip/contracts';
import {
  type DueNotification,
  type EmitOutcome,
  NotificationsService,
  type OutboundMessages,
} from '../notifications/notifications.service';
import {
  type AudienceRow,
  type CampaignRow,
  PostgresCampaignStore,
  type SendOutcome,
  type Tally,
} from './internal/campaign-store';

/**
 * Campaigns (T-332, D-075): an audience is a saved query, a send is a row.
 *
 * A send tells every active member the audience reaches through the inbox's
 * own `emit()`, so their preference for the `campaign` kind, their quiet
 * hours and a category mute apply exactly as they do to everything else --
 * a member who turned campaigns off is `muted` in the report, not reached
 * around the side. The dispatch is claimed by its primary key before the
 * first member is told, and the notification's dedupe key is the second
 * guard, so nobody is reached twice however the send is retried. The
 * carrier then takes what left the inbox out by e-mail and push with this
 * module's composer: the campaign's title and body, opening its path --
 * every page of it in the same send, bounded (T-837).
 */
/** How many campaigns' words the composer keeps before it starts again. */
const WORDS_KEPT = 16;

export type SendResult =
  | { outcome: 'sent'; dispatch: CampaignDispatch }
  | { outcome: 'already_sent' }
  | { outcome: 'no_campaign' };

@Injectable()
export class CampaignsService implements OnModuleInit {
  private readonly log = new Logger('Campaigns');
  /** Campaigns' words already read by the composer, by id (immutable rows). */
  private readonly words = new Map<string, CampaignRow>();

  constructor(
    private readonly store: PostgresCampaignStore,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.notifications.registerComposer('campaign', (due) => this.compose(due));
  }

  async audiences(): Promise<Audience[]> {
    const rows = await this.store.audiences();
    return Promise.all(rows.map((row) => this.audienceOf(row)));
  }

  async audience(id: string): Promise<Audience | null> {
    const row = await this.store.audience(id);
    return row === null ? null : this.audienceOf(row);
  }

  async createAudience(input: {
    name: string;
    filter: AudienceFilter;
    actorId: string;
    reason: string;
  }): Promise<Audience> {
    const id = await this.store.createAudience(input);
    const created = await this.audience(id);
    if (created === null) throw new Error('audience vanished after insert');
    return created;
  }

  async campaigns(): Promise<Campaign[]> {
    return (await this.store.campaigns()).map(campaignOf);
  }

  async campaign(id: string): Promise<Campaign | null> {
    const row = await this.store.campaign(id);
    return row === null ? null : campaignOf(row);
  }

  async createCampaign(input: {
    audienceId: string;
    title: string;
    body: string;
    path: string;
    actorId: string;
    reason: string;
  }): Promise<Campaign | 'no_audience'> {
    if ((await this.store.audience(input.audienceId)) === null) return 'no_audience';
    const id = await this.store.createCampaign(input);
    const created = await this.campaign(id);
    if (created === null) throw new Error('campaign vanished after insert');
    return created;
  }

  /**
   * Send once. The claim first; then every member the audience reaches now,
   * one at a time through the inbox, each outcome a row; then the result and
   * the audit row; then the carrier, drained rather than one page, so what
   * left the inbox leaves the building without waiting for the timer.
   */
  async send(campaignId: string, actorId: string, reason: string): Promise<SendResult> {
    const row = await this.store.campaign(campaignId);
    if (row === null) return { outcome: 'no_campaign' };
    if (row.started_at !== null) return { outcome: 'already_sent' };
    const audience = await this.store.audience(row.audience_id);
    if (audience === null) return { outcome: 'no_campaign' };
    const members = await this.store.members(audience.filter);
    if (!(await this.store.claimDispatch(campaignId, actorId, reason, members.length))) {
      return { outcome: 'already_sent' };
    }
    const tally: Tally = { reached: 0, delayed: 0, muted: 0, duplicate: 0, failed: 0 };
    const reached: string[] = [];
    for (const userId of members) {
      const outcome = sendOutcomeOf(
        await this.notifications.emit({
          userId,
          kind: 'campaign',
          subjectType: 'campaign',
          subjectId: campaignId,
          dedupeKey: campaignId,
        }),
      );
      await this.store.recordSend(campaignId, userId, outcome);
      if (outcome === 'sent') {
        tally.reached += 1;
        reached.push(userId);
      } else tally[outcome] += 1;
    }
    await this.store.finishDispatch(campaignId, actorId, reason, tally);
    this.log.log(`campaign sent id=${campaignId} audience=${members.length}`, {
      event: 'campaign.sent',
      campaign_id: campaignId,
      ...tally,
    });
    // Every page, not the first (T-837): one `carry()` is a hundred, and the
    // rest used to wait for the timer's hundred every five minutes. Bounded;
    // whatever a bound leaves, the timer drains on its next tick.
    if (reached.length > 0) {
      const drained = await this.notifications.drain({ userIds: reached });
      this.log.log(
        `campaign carried id=${campaignId} carried=${String(drained.carried)} stopped=${drained.stopped}`,
        { event: 'campaign.carried', campaign_id: campaignId, ...drained },
      );
    }
    const sent = await this.store.campaign(campaignId);
    const dispatch = sent === null ? null : dispatchOf(sent);
    if (dispatch === null) throw new Error('dispatch vanished after send');
    return { outcome: 'sent', dispatch };
  }

  /** The carrier's words for a campaign: its title and body, opening its path. */
  private async compose(due: DueNotification): Promise<OutboundMessages | null> {
    const row = await this.campaignFor(due.subject_id);
    if (row === null) return null;
    const path = `/${due.locale}${row.path}`;
    return {
      email: { to: due.email, subject: row.title, text: `${row.body}\n\n${path}` },
      push: { userId: due.user_id, title: row.title, body: row.body, url: path },
    };
  }

  /**
   * A campaign's words for the composer, read once per campaign rather than
   * once per member (T-837: a 10,000-member send composes 10,000 times). Safe
   * to keep because a campaign's title, body and path never change (D-075);
   * only a few are kept, and only one that exists.
   */
  private async campaignFor(id: string): Promise<CampaignRow | null> {
    const known = this.words.get(id);
    if (known !== undefined) return known;
    const row = await this.store.campaign(id);
    if (row === null) return null;
    if (this.words.size >= WORDS_KEPT) this.words.clear();
    this.words.set(id, row);
    return row;
  }

  private async audienceOf(row: AudienceRow): Promise<Audience> {
    return {
      id: row.id,
      name: row.name,
      filter: row.filter,
      created_by: row.created_by,
      reason: row.reason,
      created_at: row.created_at.toISOString(),
      size: await this.store.size(row.filter),
    };
  }
}

/** The inbox's outcome in the campaign's words; capped and blocked cannot happen to a sourceless, uncapped kind. */
function sendOutcomeOf(outcome: EmitOutcome): SendOutcome {
  switch (outcome) {
    case 'sent':
    case 'delayed':
    case 'muted':
    case 'duplicate':
      return outcome;
    default:
      return 'failed';
  }
}

function dispatchOf(row: CampaignRow): CampaignDispatch | null {
  if (row.started_at === null) return null;
  return {
    started_by: row.started_by,
    started_at: row.started_at.toISOString(),
    audience_size: row.audience_size ?? 0,
    reason: row.dispatch_reason ?? '',
    finished_at: row.finished_at?.toISOString() ?? null,
    reached: row.reached ?? 0,
    delayed: row.delayed ?? 0,
    muted: row.muted ?? 0,
    duplicate: row.duplicate ?? 0,
    failed: row.failed ?? 0,
  };
}

function campaignOf(row: CampaignRow): Campaign {
  return {
    id: row.id,
    audience_id: row.audience_id,
    audience_name: row.audience_name,
    title: row.title,
    body: row.body,
    path: row.path,
    created_by: row.created_by,
    reason: row.reason,
    created_at: row.created_at.toISOString(),
    dispatch: dispatchOf(row),
  };
}
