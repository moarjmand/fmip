'use client';

import Link from '@/components/ui/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { MessageText } from '@/components/message-text';
import type { Message } from '@/i18n/messages';
import type { PushOfferMessages } from '@/lib/notification-messages';
import { pushOfferKeyAction } from '@/lib/push-actions';
import {
  type FollowIntent,
  type OfferedType,
  isDismissed,
  rememberDismissal,
  shouldOffer,
  takeFollowIntent,
} from '@/lib/push-offer';
import { pushSupported, subscribeThisDevice } from '@/lib/push-subscribe';
import { Button } from '@/components/ui';

/**
 * Push, offered at the moment a member follows something (T-1429). Settings →
 * Notifications has always had the switch; nobody found it. The moment a
 * member follows a team, a competition or a match is the moment alerts mean
 * something to them, so that is where the offer appears -- after the click,
 * never on a page load, and the browser's own permission prompt only after
 * they say yes. "Not now" quiets it on this device for a while; a browser
 * that cannot take push, has refused it, or already receives it is never
 * offered. The rules are `@/lib/push-offer`. The live region around it is
 * `PushOfferFor`'s, drawn on the server, so the offer is announced when it
 * appears.
 */

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

type View = 'hidden' | 'asking' | 'working' | 'on' | 'denied' | 'failed';

export function PushOffer({
  locale,
  entity,
  question,
  messages,
}: {
  locale: string;
  /** The follow this offer belongs to; null to answer any follow on the page. */
  entity: { type: OfferedType; id: string } | null;
  /** "Get goal and line-up alerts for <name> on this device?", resolved on the server. */
  question: Message;
  /** `PUSH_OFFER_KEYS`, resolved on the server. */
  messages: PushOfferMessages;
}) {
  const [view, setView] = useState<View>('hidden');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Taken once per mount, so a development double effect does not lose it.
  const intent = useRef<FollowIntent | null | undefined>(undefined);
  const publicKey = useRef<string | null>(null);
  const entityType = entity?.type ?? null;
  const entityId = entity?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    const decide = async () => {
      const now = Date.now();
      if (intent.current === undefined) {
        intent.current = takeFollowIntent(
          sessionStore(),
          entityType === null || entityId === null ? null : { type: entityType, id: entityId },
          now,
        );
      }
      if (intent.current === null || !pushSupported()) return;
      // No service worker, no push: the offer would promise what the device cannot do.
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration === undefined) return;
      const subscription = await registration.pushManager.getSubscription();
      const ask = shouldOffer({
        supported: true,
        permission: Notification.permission,
        subscribed: subscription !== null,
        dismissed: isDismissed(localStore(), now),
      });
      if (!ask) return;
      const key = await pushOfferKeyAction();
      if (key === null || cancelled) return;
      publicKey.current = key;
      setView('asking');
    };
    decide().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  const accept = () =>
    start(async () => {
      const key = publicKey.current;
      if (key === null) return;
      setView('working');
      const outcome = await subscribeThisDevice(locale, key);
      if (outcome.ok) {
        setView('on');
      } else if (outcome.reason === 'denied') {
        // The browser said no; asking again through this offer would be nagging.
        rememberDismissal(localStore(), Date.now());
        setView('denied');
      } else {
        setFailure(outcome.message);
        setView('failed');
      }
    });

  const decline = () => {
    rememberDismissal(localStore(), Date.now());
    setView('hidden');
  };

  const settings = (
    <Link href={`/${locale}/settings/notifications`} className="underline">
      <MessageText message={messages['pushOffer.settings']} />
    </Link>
  );

  return (
    <>
      {(view === 'asking' || view === 'working') && (
        <div
          className="flex flex-col gap-2 rounded border border-default bg-surface px-3 py-2 text-sm"
          data-testid="push-offer"
        >
          <p className="font-semibold">
            <MessageText message={question} />
          </p>
          <p className="text-muted">
            <MessageText message={messages['pushOffer.detail']} />
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={accept}
              pending={pending || view === 'working'}
              data-testid="push-offer-yes"
            >
              <MessageText message={messages['pushOffer.yes']} />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={decline}
              disabled={pending || view === 'working'}
              data-testid="push-offer-no"
            >
              <MessageText message={messages['pushOffer.notNow']} />
            </Button>
          </div>
        </div>
      )}
      {(view === 'on' || view === 'denied' || view === 'failed') && (
        <p className="text-sm" role="status" data-testid="push-offer-outcome" data-outcome={view}>
          {view === 'failed' && failure !== null ? (
            failure
          ) : (
            <MessageText
              message={
                messages[
                  view === 'on'
                    ? 'pushOffer.on'
                    : view === 'denied'
                      ? 'pushOffer.denied'
                      : 'pushOffer.failed'
                ]
              }
            />
          )}{' '}
          {settings}
        </p>
      )}
    </>
  );
}
