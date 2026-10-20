import { subscribePushAction } from '@/lib/push-actions';

/**
 * The browser side of turning push on for this device (T-330, D-074), shared
 * by the Settings switch and the offer at a follow (T-1429). The permission
 * prompt is asked here and only here, so it only ever follows a member's
 * click on a button that says what it does.
 */

export type SubscribeOutcome =
  | { ok: true }
  | { ok: false; reason: 'denied' }
  | { ok: false; reason: 'notRegistered'; message: string | null }
  | { ok: false; reason: 'failed'; message: string | null };

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Service worker, push and notifications all present in this browser. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Ask, subscribe with the deployment's key, and hand the result to the API. */
export async function subscribeThisDevice(
  locale: string,
  publicKey: string,
): Promise<SubscribeOutcome> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: 'denied' };
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    const outcome = await subscribePushAction(locale, subscription.toJSON());
    if (!outcome?.ok) {
      await subscription.unsubscribe();
      return { ok: false, reason: 'notRegistered', message: outcome?.message ?? null };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'failed', message: error instanceof Error ? error.message : null };
  }
}
