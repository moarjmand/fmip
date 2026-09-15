'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import type { Notification, NotificationsResponse } from '@fmip/contracts';
import { notificationHref, notificationLine } from '@/lib/notification-links';
import { readAllAction, readOneAction } from '@/lib/notification-actions';

/**
 * The inbox, as a member reads it (blueprint 12.2, T-272).
 *
 * **A notification that cannot be opened is still shown.** The API sends no
 * label for a subject that no longer resolves — a group that was deleted — and
 * this renders the sentence without a link rather than one that 404s. What
 * happened is still true; only the destination is gone (rule 3).
 *
 * **A held notification says it was held.** A quiet-hours delay or a frequency
 * cap that left no trace would make the inbox quietly incomplete, which is the
 * smallest scale rule 3 applies at and the easiest place to let it slide.
 */

function Row({ locale, notification }: { locale: string; notification: Notification }) {
  const [pending, start] = useTransition();
  const href = notificationHref(locale, notification);
  const line = notificationLine(notification);
  const unread = notification.read_at === null;

  const body = (
    <span className="flex flex-col gap-1">
      <span className={unread ? 'font-medium' : ''}>{line}</span>
      <time className="text-xs opacity-60" dateTime={notification.created_at}>
        {notification.created_at}
      </time>
      {notification.held_reason !== null && (
        <span className="text-xs opacity-70" data-testid="notification-held">
          Held: {notification.held_reason}
        </span>
      )}
    </span>
  );

  return (
    <li
      className="flex items-start justify-between gap-3 rounded border border-current/20 p-3"
      data-testid={unread ? 'notification-unread' : 'notification-read'}
    >
      {href === null ? (
        // No link, and no pretence of one. The API had nothing to resolve.
        <span data-testid="notification-unlinked">{body}</span>
      ) : (
        <Link href={href} className="underline" data-testid="notification-link">
          {body}
        </Link>
      )}
      {unread && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            start(async () => {
              await readOneAction(locale, notification.id);
            });
          }}
          className="shrink-0 rounded border border-current/30 px-2 py-0.5 text-xs disabled:opacity-50"
          data-testid={`notification-read-${notification.id}`}
        >
          Mark read
        </button>
      )}
    </li>
  );
}

export function NotificationList({
  locale,
  page,
  reachable,
}: {
  locale: string;
  page: NotificationsResponse | null;
  /** False when the inbox could not be fetched at all. */
  reachable: boolean;
}) {
  const [pending, start] = useTransition();

  if (!reachable || page === null) {
    // Stated, not vanished: "the inbox could not be fetched" and "nothing
    // happened" are different facts and a reader must be able to tell them
    // apart.
    return (
      <p role="alert" data-testid="notifications-unreachable">
        Your notifications cannot be shown right now.
      </p>
    );
  }

  if (page.notifications.length === 0) {
    return (
      <p className="text-sm opacity-70" data-testid="notifications-empty">
        Nothing yet. Things that happen to you and to what you wrote turn up here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {page.unread > 0 && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            start(async () => {
              await readAllAction(locale);
            });
          }}
          className="self-start rounded border border-current/30 px-3 py-1 text-sm disabled:opacity-50"
          data-testid="notifications-read-all"
        >
          Mark all {page.unread} read
        </button>
      )}
      <ul className="flex flex-col gap-2">
        {page.notifications.map((notification) => (
          <Row key={notification.id} locale={locale} notification={notification} />
        ))}
      </ul>
    </div>
  );
}
