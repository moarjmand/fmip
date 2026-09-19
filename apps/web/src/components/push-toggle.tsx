'use client';

import { useEffect, useState, useTransition } from 'react';
import type { PushState } from '@fmip/contracts';
import { subscribePushAction, unsubscribePushAction } from '@/lib/push-actions';

/**
 * Push on this device (T-330, D-074). The browser owns the subscription: it
 * asks the member's permission, registers with its own push service using
 * the deployment's public key, and hands the result to the API, which
 * keeps it as one of the member's devices. Turning it off is the same in
 * reverse. Where the deployment has no push channel the section says so
 * instead of offering a switch that would do nothing.
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

export function PushToggle({ locale, push }: { locale: string; push: PushState }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [message, setMessage] = useState<string | null>(null);
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
      <p className="text-sm opacity-70" data-testid="push-absent">
        This deployment has no push channel, so nothing reaches a device; notifications stay in your
        inbox{push.email ? ' and your e-mail' : ''}.
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
          setMessage('The browser did not allow notifications for this site.');
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
          setMessage(outcome?.message ?? 'The device could not be registered.');
          return;
        }
        setPhase('on');
        setMessage('Push is on for this device.');
      } catch (error) {
        setPhase('off');
        setMessage(error instanceof Error ? error.message : 'Push could not be turned on.');
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
        setMessage('Push is off for this device.');
      } catch (error) {
        setPhase('on');
        setMessage(error instanceof Error ? error.message : 'Push could not be turned off.');
      }
    });

  return (
    <div className="flex flex-col gap-2" data-testid="push-toggle" data-phase={phase}>
      <p className="text-sm opacity-70">
        A push is the same notification your inbox has, shown by this browser even when the site is
        closed.{' '}
        {push.devices === 0
          ? 'No device is registered yet.'
          : `${push.devices} device${push.devices === 1 ? '' : 's'} registered.`}
      </p>
      {phase === 'unsupported' && (
        <p className="text-sm" data-testid="push-unsupported">
          This browser does not support push notifications.
        </p>
      )}
      {(phase === 'off' || phase === 'on' || phase === 'working') && (
        <button
          type="button"
          onClick={phase === 'on' ? turnOff : turnOn}
          disabled={pending || phase === 'working'}
          className="w-fit rounded border border-current/30 px-3 py-2"
          data-testid="push-switch"
        >
          {phase === 'on' ? 'Turn push off on this device' : 'Turn push on for this device'}
        </button>
      )}
      {message !== null && (
        <p className="text-sm" role="status" data-testid="push-message">
          {message}
        </p>
      )}
    </div>
  );
}
