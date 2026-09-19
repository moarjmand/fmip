import webpush from 'web-push';
import { NoRecipient, type OutboundPush, type PushChannel } from '../delivery.port';
import type { PostgresPushSubscriptionStore } from './push-subscriptions';

/**
 * The push channel (T-330, D-074): Web Push, the standard every browser's
 * push service speaks, signed with a VAPID key pair the deployment
 * generated once. No account anywhere: the browser's own service carries
 * it, and the key pair is the only credential. `VAPID_PUBLIC_KEY`,
 * `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` or an `https://`
 * URL the push services may contact) are all required; a channel named
 * without them refuses to start.
 *
 * A push is addressed to a member; the member's devices are the
 * subscriptions they registered (`push_subscription`), each an endpoint
 * and two keys the browser handed out. One is sent per device; a device
 * whose service answers 404 or 410 is gone and its row is removed. A member
 * with no device is a `skipped` outcome, not a failure: the channel exists,
 * they just have nowhere to receive it.
 *
 * The sender is injected so a spec can script every answer.
 */
export interface VapidSettings {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function vapidSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): VapidSettings {
  const publicKey = (env.VAPID_PUBLIC_KEY ?? '').trim();
  const privateKey = (env.VAPID_PRIVATE_KEY ?? '').trim();
  const subject = (env.VAPID_SUBJECT ?? '').trim();
  if (publicKey === '' || privateKey === '') {
    throw new Error(
      'DELIVERY_PUSH_PROVIDER=webpush needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY on the server (generate once with `npx web-push generate-vapid-keys`); a configured channel that cannot send is not allowed to start',
    );
  }
  if (!/^(mailto:|https:\/\/)/.test(subject)) {
    throw new Error(
      'DELIVERY_PUSH_PROVIDER=webpush needs VAPID_SUBJECT, a mailto: address or an https:// URL the push services may contact about this sender',
    );
  }
  return { publicKey, privateKey, subject };
}

/** What is sent to one device: the sentence and where it opens. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

/** The one call this channel makes of `web-push`; a status code is what a push service answers with. */
export type PushSender = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
) => Promise<void>;

export class PushServiceError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export class WebPushChannel implements PushChannel {
  readonly provider = 'webpush';

  constructor(
    readonly publicKey: string,
    private readonly subscriptions: PostgresPushSubscriptionStore,
    private readonly sender: PushSender,
  ) {}

  static fromSettings(
    settings: VapidSettings,
    subscriptions: PostgresPushSubscriptionStore,
  ): WebPushChannel {
    const details = {
      subject: settings.subject,
      publicKey: settings.publicKey,
      privateKey: settings.privateKey,
    };
    return new WebPushChannel(settings.publicKey, subscriptions, async (subscription, payload) => {
      try {
        await webpush.sendNotification(subscription, payload, {
          vapidDetails: details,
          TTL: 24 * 60 * 60,
        });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        throw new PushServiceError(
          status ?? 0,
          error instanceof Error ? error.message : String(error),
        );
      }
    });
  }

  async send(push: OutboundPush): Promise<void> {
    const devices = await this.subscriptions.forMember(push.userId);
    if (devices.length === 0) throw new NoRecipient('no device');
    const payload = JSON.stringify({
      title: push.title,
      body: push.body,
      url: push.url,
    } satisfies PushPayload);
    let delivered = 0;
    let lastError: Error | null = null;
    for (const device of devices) {
      try {
        await this.sender(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          payload,
        );
        await this.subscriptions.touch(device.id);
        delivered += 1;
      } catch (error) {
        if (
          error instanceof PushServiceError &&
          (error.statusCode === 404 || error.statusCode === 410)
        ) {
          // The browser let the subscription lapse; the row is a device that no longer exists.
          await this.subscriptions.removeGone(device.id);
          continue;
        }
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    if (delivered === 0) throw lastError ?? new NoRecipient('no device');
  }
}
