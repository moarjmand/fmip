import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { NotificationKind, NotificationSubject } from '@fmip/contracts';
import {
  NOTIFICATION_CATEGORY_OF,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_HOURLY_CAP,
  isNotificationKind,
  notificationLine,
  notificationPath,
} from '@fmip/contracts';
import type { OutboundEmail, OutboundPush } from '../delivery/delivery.port';
import { DeliveryService } from '../delivery/delivery.service';
import {
  type DueNotification,
  type MuteRow,
  PostgresNotificationsStore,
  type NewNotification,
} from './internal/notifications-store';

export type { DueNotification } from './internal/notifications-store';

/** What a carrier composes for one due notification: a message per channel, or `null` for a channel it has nothing for. */
export interface OutboundMessages {
  email: OutboundEmail | null;
  push: OutboundPush | null;
}

/** One pass of `carry()`: how many were due, and how many this pass claimed and carried. */
export interface CarryReport {
  due: number;
  carried: number;
}

/** A producer's own words for its kind, richer than the sentence: the briefing sends its prose (T-432). */
export type Composer = (due: DueNotification) => Promise<OutboundMessages | null>;

/** The web origin an e-mail's link is built on; the same `WEB_BASE_URL` identity uses. */
export const WEB_ORIGIN = Symbol('WEB_ORIGIN');

/** How often held and missed notifications are carried once they are due (T-330). */
const CARRY_EVERY_MS = 5 * 60_000;
/** The push's title; the sentence is its body. */
const PUSH_TITLE = 'FMIP';

/**
 * Emitting in-product notifications (blueprint 12.2, T-271).
 *
 * **Emitting must never fail the thing that caused it.** A friend request that
 * succeeded and then threw because a notification could not be written is a
 * friend request the member is told failed, and they will send it again. So
 * `emit` catches, logs and returns — the notification is the consequence, and a
 * consequence that breaks its cause has the relationship backwards.
 *
 * That is a deliberate asymmetry with the rest of this codebase, where a failed
 * write is an error. It is safe here only because nothing depends on a
 * notification existing: the inbox is a convenience over records that are
 * already durable elsewhere.
 *
 * **The block is not checked here.** `notification_block_guard` refuses one
 * whose source the recipient blocked (`PL003`), and this treats that refusal as
 * an ordinary outcome rather than an error. A check in this file would be a
 * second copy of the rule, and it would go stale the moment a block was created
 * between the check and the write.
 */

/** The database's word for "these two must not reach each other". */
const BLOCKED = 'PL003';
/** And Postgres's for "that already exists", which here means "already sent". */
const DUPLICATE = '23505';

export interface EmitRequest {
  /** Who is being told. */
  userId: string;
  kind: NotificationKind;
  subjectType: NotificationSubject;
  subjectId: string;
  /** Who caused it. Omit for an event with no member behind it, like a settlement. */
  sourceId?: string | null;
  /**
   * What counts as the same notification. Omit when there is nothing to say:
   * two messages an hour apart are two notifications.
   */
  dedupeKey?: string | null;
}

/** What happened, for a caller that wants to know and a test that must. */
export type EmitOutcome =
  | 'sent'
  /** Written, but waiting for the member's quiet hours to end (T-273). */
  | 'delayed'
  /** Not written: they had already been told enough times this hour. */
  | 'capped'
  | 'muted'
  | 'duplicate'
  | 'blocked'
  | 'failed';

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(NotificationsService.name);
  private readonly composers = new Map<NotificationKind, Composer>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: PostgresNotificationsStore,
    private readonly delivery: DeliveryService,
    @Inject(WEB_ORIGIN) private readonly webOrigin: string,
  ) {}

  /** A held notification leaves when its hold ends; a missed one on the next pass. Nothing waits on this. */
  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.carry().catch((error: unknown) =>
        this.log.error(
          `notification.carry_failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }, CARRY_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  /** A producer with more to say than the sentence registers its own words for its kind (T-432). */
  registerComposer(kind: NotificationKind, compose: Composer): void {
    this.composers.set(kind, compose);
  }

  /**
   * Whether this member would receive this kind.
   *
   * The defaults are overlaid here rather than stored per member, so changing
   * one reaches everybody who never chose (T-270). A kind with no stored row is
   * the documented default; a stored row is their own decision and wins.
   */
  async wants(userId: string, kind: NotificationKind): Promise<boolean> {
    const [muted, categories] = await Promise.all([
      this.store.mutedKinds(userId),
      this.store.mutedCategories(userId),
    ]);
    if (muted.has(kind) || categories.has(NOTIFICATION_CATEGORY_OF[kind])) return false;
    return NOTIFICATION_DEFAULTS[kind];
  }

  /**
   * Tell one member about one thing.
   *
   * Never throws. The outcome says what happened, and every outcome but `failed`
   * is an ordinary day: a member turned this kind off, the same event was
   * already reported, or the two of them cannot reach each other.
   */
  async emit(request: EmitRequest): Promise<EmitOutcome> {
    try {
      if (!(await this.wants(request.userId, request.kind))) return 'muted';
      // A team or competition the member silenced (T-331): what this is about,
      // not what kind it is, so one team goes quiet and football does not.
      if (
        (await this.store.mutedFor(request.userId, request.subjectType, request.subjectId)) !== null
      ) {
        return 'muted';
      }

      // **Dropped, and the inbox still says so.** Over the ceiling nothing new
      // is written -- the tenth message notification in an hour tells a member
      // nothing the ninth did not -- but the newest one of that kind is marked
      // with how many were held behind it. A row per suppressed event would be
      // the flood again with a note attached, and silence would be a lie
      // (rule 3, T-270).
      const cap = NOTIFICATION_HOURLY_CAP[request.kind];
      if (cap !== undefined) {
        const { count, newest } = await this.store.sentThisHour(request.userId, request.kind);
        if (count >= cap && newest !== null) {
          await this.store.noteHeldBehind(newest);
          return 'capped';
        }
      }

      // **Delayed, never thrown away.** Quiet hours are about *when* somebody is
      // disturbed, not whether they are told: dropping a moderation decision
      // because it landed at two in the morning would be the product deciding a
      // member did not need to know. The row exists now and surfaces when their
      // window ends.
      const quietUntil = await this.store.quietUntil(request.userId);

      const entry: NewNotification = {
        userId: request.userId,
        kind: request.kind,
        subjectType: request.subjectType,
        subjectId: request.subjectId,
        sourceId: request.sourceId ?? null,
        dedupeKey: request.dedupeKey ?? null,
        deliverAfter: quietUntil?.toISOString() ?? null,
        heldReason: quietUntil === null ? null : 'your quiet hours',
      };
      const written = await this.store.write(entry);
      if (!written) return 'duplicate';
      return quietUntil === null ? 'sent' : 'delayed';
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      // Not a failure: the recipient blocked the source, or the other way
      // round, and the database said so before the row existed (T-270).
      if (code === BLOCKED) return 'blocked';
      if (code === DUPLICATE) return 'duplicate';
      // Anything else is a real fault, logged with what it was about and
      // swallowed, because the event that caused it already happened and must
      // not be undone by its own footnote.
      this.log.error(
        `notification.emit_failed kind=${request.kind} user=${request.userId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return 'failed';
    }
  }

  /**
   * Carry every due notification out of the building, through the delivery
   * port (T-330, T-432).
   *
   * Everything upstream has already decided the member should be told: the
   * row exists, its hold has ended (quiet hours delay, and `due` honours the
   * delay), and it is not muted or capped, or it would not be a row. What is
   * decided here is only that it leaves once. **The claim is written before
   * the send**, unique per notification, so a second carrier -- a retry, a
   * second process, the timer racing a request -- finds it taken and does
   * nothing; deduplicating afterwards from logs is how one retry becomes two
   * e-mails. The outcome on each channel is then recorded once, and an
   * absent channel is an outcome too.
   *
   * **With no channel at all nothing is claimed.** The inbox already says it
   * is the only place a notification exists, and a claim that could only
   * ever say `absent` would be a row per notification for nothing; when a
   * channel arrives, `due` carries the last day and not the month before.
   *
   * The words are the contract's sentence and route, the same the inbox
   * shows, so an e-mail and a push open exactly what the inbox opens; a
   * producer with more to say registers a composer for its kind.
   */
  async carry(): Promise<CarryReport> {
    if (this.delivery.describe().in_product_only) return { due: 0, carried: 0 };
    const due = await this.store.due();
    let carried = 0;
    for (const item of due) {
      if (!(await this.store.claimDelivery(item.id))) continue;
      let messages: OutboundMessages | null = null;
      try {
        const compose = isNotificationKind(item.kind) ? this.composers.get(item.kind) : undefined;
        messages = compose === undefined ? this.composeLine(item) : await compose(item);
      } catch (error) {
        this.log.error(
          `notification.compose_failed kind=${item.kind} notification=${item.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
      const outcome = await this.delivery.deliver(messages?.email ?? null, messages?.push ?? null);
      await this.store.recordDelivery(item.id, outcome);
      carried += 1;
    }
    return { due: due.length, carried };
  }

  /** The sentence and the route, as the inbox shows them; a route that cannot be opened is left out of the e-mail and sends the push to the inbox. */
  private composeLine(due: DueNotification): OutboundMessages | null {
    if (!isNotificationKind(due.kind)) return null;
    const line = notificationLine({ kind: due.kind, source: due.source });
    const path = notificationPath(due.locale, {
      subject_type: due.subject_type as NotificationSubject,
      subject_id: due.subject_id,
      subject_label: due.subject_label,
    });
    return {
      email: {
        to: due.email,
        subject: line,
        text: path === null ? line : `${line}\n\n${this.webOrigin}${path}`,
      },
      push: {
        userId: due.user_id,
        title: PUSH_TITLE,
        body: line,
        url: path ?? `/${due.locale}/notifications`,
      },
    };
  }

  /** The inbox itself (T-272). Only what is deliverable now; held ones wait. */
  inbox(userId: string, limit: number) {
    return this.store.inbox(userId, limit);
  }

  unread(userId: string): Promise<number> {
    return this.store.unreadCount(userId);
  }

  readAll(userId: string): Promise<number> {
    return this.store.readAll(userId);
  }

  read(notificationId: string, userId: string): Promise<boolean> {
    return this.store.read(notificationId, userId);
  }

  mutedKinds(userId: string): Promise<Set<string>> {
    return this.store.mutedKinds(userId);
  }

  chosenKinds(userId: string): Promise<Set<string>> {
    return this.store.chosenKinds(userId);
  }

  // --- mutes (T-331) ----------------------------------------------------

  mutes(userId: string): Promise<MuteRow[]> {
    return this.store.mutes(userId);
  }

  mute(userId: string, scope: string, target: string): Promise<'muted' | 'unknown'> {
    return this.store.mute(userId, scope, target);
  }

  unmute(userId: string, scope: string, target: string): Promise<boolean> {
    return this.store.unmute(userId, scope, target);
  }

  setPreference(userId: string, kind: NotificationKind, inProduct: boolean): Promise<void> {
    return this.store.setPreference(userId, kind, inProduct);
  }

  quietHours(userId: string): Promise<{ starts_at: string; ends_at: string } | null> {
    return this.store.quietHours(userId);
  }

  setQuietHours(userId: string, starts: string, ends: string): Promise<void> {
    return this.store.setQuietHours(userId, starts, ends);
  }

  clearQuietHours(userId: string): Promise<void> {
    return this.store.clearQuietHours(userId);
  }

  /**
   * Tell several members about one thing.
   *
   * Sequential rather than `Promise.all`, and the reason is the blast radius: a
   * group of two hundred would otherwise open two hundred connections at once
   * for the least important write in the product. The cause has already
   * committed, so nothing is waiting on this.
   */
  async emitMany(requests: EmitRequest[]): Promise<EmitOutcome[]> {
    const outcomes: EmitOutcome[] = [];
    for (const request of requests) outcomes.push(await this.emit(request));
    return outcomes;
  }
}
