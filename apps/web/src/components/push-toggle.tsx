'use client';

import { useEffect, useState, useTransition } from 'react';
import type { PushState } from '@fmip/contracts';
import { MessageText } from '@/components/message-text';
import type { Message } from '@/i18n/messages';
import type { PushToggleMessages } from '@/lib/notification-messages';
import { subscribePushAction, unsubscribePushAction } from '@/lib/push-actions';
import { Button } from '@/components/ui';

/**
 * Push on this device (T-330, D-074). The browser owns the subscription: it
 * asks the member's permission, registers with its own push service using
 * the deployment's public key, and hands the result to the API, which
 * keeps it as one of the member's devices. Turning it off is the same in
 * reverse. Where the deployment has no push channel the section says so
 * instead of offering a switch that would do nothing.
 *
 * Its words are resolved on the server for the reader's locale and handed
 * down (T-1040, T-1305); the device count is a plural resolved there too.
 */
type Phase = 'checking' | 'unsupported' | 'off' | 'on' | 'working';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function PushToggle({
  locale,
  push,
  messages,
  devices,
}: {
  locale: string;
  push: PushState;
  /** `PUSH_TOGGLE_KEYS`, resolved on the server. */
  messages: PushToggleMessages;
  /** "N devices registered.", resolved as a plural on the server; `null` when there are none. */
  devices: Message | null;
}) {
  const [phase, setPhase] = useState<Phase>('checking');
  // A catalogue message, or the browser's or the API's own words for a failure.
  const [message, setMessage] = useState<Message | string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (push.state !== 'configured') return;
    let cancelled = false;
    // Asked after the first paint, never during it: the browser's answer is
    // what decides the switch, and a render that guessed would be wrong on
    // one browser or the other.
    const detect = async (): Promise<Phase> => {
      await Promise.resolve();
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      return subscription === null ? 'off' : 'on';
    };
    detect()
      .catch((): Phase => 'unsupported')
      .then((next) => {
        if (!cancelled) setPhase(next);
      });
    return () => {
      cancelled = true;
    };
  }, [push.state]);

  if (push.state !== 'configured') {
    return (
      <p className="text-sm text-muted" data-testid="push-absent">
        <MessageText
          message={messages[push.email ? 'alerts.push.absentEmail' : 'alerts.push.absent']}
        />
      </p>
    );
  }

  const publicKey = push.public_key;

  const turnOn = () =>
    start(async () => {
      setMessage(null);
      setPhase('working');
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setPhase('off');
          setMessage(messages['alerts.push.denied']);
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        const outcome = await subscribePushAction(locale, subscription.toJSON());
        if (!outcome?.ok) {
          await subscription.unsubscribe();
          setPhase('off');
          setMessage(outcome?.message ?? messages['alerts.push.notRegistered']);
          return;
        }
        setPhase('on');
        setMessage(messages['alerts.push.isOn']);
      } catch (error) {
        setPhase('off');
        setMessage(error instanceof Error ? error.message : messages['alerts.push.couldNotOn']);
      }
    });

  const turnOff = () =>
    start(async () => {
      setMessage(null);
      setPhase('working');
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription !== null) {
          await unsubscribePushAction(locale, subscription.endpoint);
          await subscription.unsubscribe();
        }
        setPhase('off');
        setMessage(messages['alerts.push.isOff']);
      } catch (error) {
        setPhase('on');
        setMessage(error instanceof Error ? error.message : messages['alerts.push.couldNotOff']);
      }
    });

  return (
    <div className="flex flex-col gap-2" data-testid="push-toggle" data-phase={phase}>
      <p className="text-sm text-muted">
        <MessageText message={messages['alerts.push.intro']} />{' '}
        <MessageText message={devices ?? messages['alerts.push.noDevice']} />
      </p>
      {phase === 'unsupported' && (
        <p className="text-sm" data-testid="push-unsupported">
          <MessageText message={messages['alerts.push.unsupported']} />
        </p>
      )}
      {(phase === 'off' || phase === 'on' || phase === 'working') && (
        <Button
          size="md"
          onClick={phase === 'on' ? turnOff : turnOn}
          pending={pending || phase === 'working'}
          className="w-fit"
          data-testid="push-switch"
        >
          <MessageText
            message={messages[phase === 'on' ? 'alerts.push.turnOff' : 'alerts.push.turnOn']}
          />
        </Button>
      )}
      {message !== null && (
        <p className="text-sm" role="status" data-testid="push-message">
          {typeof message === 'string' ? message : <MessageText message={message} />}
        </p>
      )}
    </div>
  );
}
