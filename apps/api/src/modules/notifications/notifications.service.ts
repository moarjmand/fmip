import { Injectable, Logger } from '@nestjs/common';
import type { NotificationKind, NotificationSubject } from '@fmip/contracts';
import { NOTIFICATION_DEFAULTS, NOTIFICATION_HOURLY_CAP } from '@fmip/contracts';
import { PostgresNotificationsStore, type NewNotification } from './internal/notifications-store';

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
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(private readonly store: PostgresNotificationsStore) {}

  /**
   * Whether this member would receive this kind.
   *
   * The defaults are overlaid here rather than stored per member, so changing
   * one reaches everybody who never chose (T-270). A kind with no stored row is
   * the documented default; a stored row is their own decision and wins.
   */
  async wants(userId: string, kind: NotificationKind): Promise<boolean> {
    const muted = await this.store.mutedKinds(userId);
    return muted.has(kind) ? false : NOTIFICATION_DEFAULTS[kind];
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
