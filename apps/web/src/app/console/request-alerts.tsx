'use client';

import { useEffect, useState } from 'react';
import { registerReminderDevice, setRequestAlerts } from '@/lib/console-actions';

/**
 * «اعلان درخواست‌های تازه» (T-1832, D-425): a browser notification when
 * someone else files a teammate request. It rides on the calendar's
 * reminders: the same service worker (`reminders-worker`, scoped to the
 * console), the same VAPID key and the same browser registration; this
 * switch adds one thing, the person's wish (`request_alerts`), which the
 * server reads before sending. Switching it off leaves the browser
 * registered, so the calendar's reminders keep coming.
 */

/** What this browser can do, as far as the page can tell. */
export type Support = 'checking' | 'unsupported' | 'denied' | 'ready';

/** What the switch says. */
export type AlertView =
  'checking' | 'absent' | 'unsupported' | 'denied' | 'on' | 'on_elsewhere' | 'off';

/** The switch's state from the server's answer and this browser's. Pure. */
export function alertView({
  configured,
  support,
  wanted,
  subscribed,
}: {
  configured: boolean;
  support: Support;
  wanted: boolean;
  subscribed: boolean;
}): AlertView {
  if (!configured) return 'absent';
  if (support === 'checking') return 'checking';
  if (support === 'unsupported') return 'unsupported';
  if (support === 'denied') return wanted ? 'on_elsewhere' : 'denied';
  if (!wanted) return 'off';
  return subscribed ? 'on' : 'on_elsewhere';
}

export const ALERT_WORDS: Record<AlertView, string> = {
  checking: 'در حال بررسی این مرورگر…',
  absent: 'فرستادن اعلان روی این سرور روشن نیست؛ درخواست‌های تازه فقط در همین صفحه دیده می‌شوند.',
  unsupported:
    'این مرورگر اعلان نمی‌گیرد. در آیفون، کنسول را با «افزودن به صفحهٔ اصلی» نصب کنید و از همان باز کنید.',
  denied:
    'مرورگر اعلان این نشانی را مسدود کرده است؛ از تنظیمات سایت در مرورگر اجازه دهید و صفحه را دوباره باز کنید.',
  on: 'روشن است: وقتی کس دیگری درخواستی ثبت کند، روی این مرورگر اعلان می‌آید.',
  on_elsewhere:
    'برای شما روشن است، ولی این مرورگر هنوز اعلان نمی‌گیرد؛ اعلان‌ها به مرورگرهای دیگرتان می‌رود.',
  off: 'خاموش است: درخواست‌های تازه اعلان نمی‌شوند.',
};

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

export function RequestAlerts({
  configured,
  publicKey,
  wanted: initiallyWanted,
  workerUrl,
  scope,
}: {
  configured: boolean;
  publicKey: string | null;
  wanted: boolean;
  workerUrl: string;
  scope: string;
}) {
  const [support, setSupport] = useState<Support>('checking');
  const [subscribed, setSubscribed] = useState(false);
  const [wanted, setWanted] = useState(initiallyWanted);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      if (
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        if (live) setSupport('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        if (live) setSupport('denied');
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration(scope);
      const subscription = await registration?.pushManager.getSubscription();
      if (live) {
        setSubscribed(subscription !== null && subscription !== undefined);
        setSupport('ready');
      }
    })().catch(() => {
      if (live) setSupport('unsupported');
    });
    return () => {
      live = false;
    };
  }, [scope]);

  const view = alertView({ configured, support, wanted, subscribed });

  async function switchOn() {
    if (publicKey === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        if (permission === 'denied') setSupport('denied');
        setMessage('بدون اجازهٔ مرورگر اعلانی نمی‌آید.');
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
        return;
      }
      setSubscribed(true);
      const set = await setRequestAlerts(true);
      if (!set.ok) {
        setMessage(set.error);
        return;
      }
      setWanted(true);
    } catch {
      setMessage('روشن کردن اعلان ممکن نشد. دوباره امتحان کنید.');
    } finally {
      setBusy(false);
    }
  }

  async function switchOff() {
    setBusy(true);
    setMessage(null);
    try {
      const set = await setRequestAlerts(false);
      if (!set.ok) setMessage(set.error);
      else setWanted(false);
    } catch {
      setMessage('خاموش کردن ممکن نشد.');
    } finally {
      setBusy(false);
    }
  }

  const canSwitch = view === 'on' || view === 'on_elsewhere' || view === 'off';
  const checked = view === 'on' || view === 'on_elsewhere';
  return (
    <div className="flex flex-col gap-2" data-testid="request-alerts" data-view={view}>
      <div className="flex items-center justify-between gap-3">
        <span id="request-alerts-label" className="text-sm font-bold text-fg">
          اعلان درخواست‌های تازه
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby="request-alerts-label"
          disabled={!canSwitch || busy}
          onClick={checked ? switchOff : switchOn}
          className={`inline-flex h-8 w-14 shrink-0 items-center rounded-pill border-2 px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 ${
            checked
              ? 'justify-end border-brand bg-brand'
              : 'justify-start border-strong bg-surface-raised'
          }`}
        >
          <span aria-hidden="true" className="inline-block size-6 rounded-pill bg-surface shadow" />
        </button>
      </div>
      <p
        className={`text-sm ${view === 'denied' || view === 'unsupported' ? 'text-warning' : 'text-muted'}`}
        role="status"
        aria-live="polite"
      >
        {busy ? '…' : ALERT_WORDS[view]}
      </p>
      {view === 'on_elsewhere' && support === 'ready' && (
        <button
          type="button"
          onClick={switchOn}
          disabled={busy}
          className="min-h-touch self-start rounded-control border border-strong px-3 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60"
        >
          این مرورگر هم اعلان بگیرد
        </button>
      )}
      {message !== null && <p className="text-sm text-danger">{message}</p>}
      <p className="text-xs text-caption">
        فقط درخواست‌هایی که دیگران ثبت می‌کنند اعلان می‌شوند، نه درخواست خود شما؛ در اعلان فقط نام
        ثبت‌کننده و عنوان درخواست می‌آید. در آیفون، اعلان فقط وقتی می‌رسد که کنسول با «افزودن به
        صفحهٔ اصلی» نصب شده و از همان باز شده باشد. خاموش کردن، یادآورهای تقویم را خاموش نمی‌کند.
      </p>
    </div>
  );
}
