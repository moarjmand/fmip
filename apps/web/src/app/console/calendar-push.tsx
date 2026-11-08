'use client';

import { useEffect, useState } from 'react';
import { registerReminderDevice, removeReminderDevice, testReminder } from '@/lib/console-actions';

type Here = 'checking' | 'unsupported' | 'denied' | 'off' | 'on' | 'busy';

/** A VAPID key, base64url, as the bytes `PushManager.subscribe` takes. */
function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const padded = `${key}${'='.repeat((4 - (key.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const WORDS: Record<Here, string> = {
  checking: 'در حال بررسی این مرورگر…',
  unsupported:
    'این مرورگر اعلان نمی‌گیرد. در آیفون، کنسول را با «افزودن به صفحهٔ اصلی» نصب کنید و از همان باز کنید.',
  denied: 'اجازهٔ اعلان برای این نشانی بسته است؛ از تنظیمات سایت در مرورگر بازش کنید.',
  off: 'یادآورها روی این مرورگر خاموش است.',
  on: 'یادآورها روی این مرورگر روشن است.',
  busy: '…',
};

/**
 * Reminders on this browser (T-1788, D-391): the console's own service
 * worker, scoped to the console (`reminders-worker` under its base), subscribes
 * with the site's VAPID key and the subscription is kept for this person.
 * The server sends each reminder to every browser switched on.
 */
export function CalendarPush({
  configured,
  publicKey,
  devices,
  workerUrl,
  scope,
}: {
  configured: boolean;
  publicKey: string | null;
  devices: number;
  workerUrl: string;
  scope: string;
}) {
  const [here, setHere] = useState<Here>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const [count, setCount] = useState(devices);

  useEffect(() => {
    let live = true;
    (async () => {
      if (
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        if (live) setHere('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        if (live) setHere('denied');
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration(scope);
      const subscription = await registration?.pushManager.getSubscription();
      if (live) setHere(subscription ? 'on' : 'off');
    })().catch(() => {
      if (live) setHere('unsupported');
    });
    return () => {
      live = false;
    };
  }, [scope]);

  async function switchOn() {
    if (publicKey === null) return;
    setHere('busy');
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setHere(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const registration = await navigator.serviceWorker.register(workerUrl, { scope });
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      const saved = await registerReminderDevice(subscription.toJSON());
      if (!saved.ok) {
        setMessage(saved.error);
        setHere('off');
        return;
      }
      setCount((n) => n + 1);
      setHere('on');
    } catch {
      setMessage('روشن کردن یادآور ممکن نشد. دوباره امتحان کنید.');
      setHere('off');
    }
  }

  async function switchOff() {
    setHere('busy');
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration(scope);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await removeReminderDevice(subscription.endpoint);
        await subscription.unsubscribe();
        setCount((n) => Math.max(0, n - 1));
      }
      setHere('off');
    } catch {
      setMessage('خاموش کردن ممکن نشد.');
      setHere('on');
    }
  }

  async function test() {
    setMessage('…');
    const result = await testReminder();
    setMessage(
      result === null
        ? 'پیام آزمایشی فرستاده نشد.'
        : result.delivered > 0
          ? `پیام آزمایشی به ${new Intl.NumberFormat('fa-IR').format(result.delivered)} مرورگر رسید.`
          : 'هیچ مرورگری پیام را نگرفت.',
    );
  }

  if (!configured)
    return (
      <p className="text-sm text-muted">
        فرستادن اعلان روی این سرور روشن نیست؛ یادآورها فقط در همین صفحه دیده می‌شوند.
      </p>
    );

  const button =
    'min-h-touch rounded-control px-4 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60';
  return (
    <div className="flex flex-col gap-2" data-testid="calendar-push">
      <p className="text-sm text-fg" role="status" aria-live="polite">
        {WORDS[here]}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {(here === 'off' || here === 'busy') && (
          <button
            type="button"
            onClick={switchOn}
            disabled={here === 'busy'}
            className={`${button} bg-brand text-on-brand`}
          >
            روشن کردن یادآور روی این مرورگر
          </button>
        )}
        {here === 'on' && (
          <>
            <button
              type="button"
              onClick={test}
              className={`${button} border border-strong text-fg`}
            >
              فرستادن پیام آزمایشی
            </button>
            <button type="button" onClick={switchOff} className={`${button} text-muted`}>
              خاموش کردن
            </button>
          </>
        )}
      </div>
      <p className="text-xs text-caption">
        {count > 0
          ? `یادآورها برای شما به ${new Intl.NumberFormat('fa-IR').format(count)} مرورگر فرستاده می‌شود.`
          : 'هنوز هیچ مرورگری از شما یادآور نمی‌گیرد.'}
      </p>
      {message !== null && <p className="text-sm text-muted">{message}</p>}
    </div>
  );
}
