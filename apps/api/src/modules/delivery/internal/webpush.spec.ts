import { describe, expect, it } from 'vitest';
import { NoRecipient } from '../delivery.port';
import type { PostgresPushSubscriptionStore, PushSubscriptionRow } from './push-subscriptions';
import { PushServiceError, WebPushChannel, vapidSettingsFromEnv } from './webpush';

/**
 * The Web Push channel (D-074): named without its keys or its subject it
 * refuses to start; a push goes to every device the member registered,
 * a device whose service says it is gone is removed, and a member with no
 * device is `NoRecipient`, which the port records as skipped.
 */
function store(rows: PushSubscriptionRow[]) {
  const removed: string[] = [];
  const touched: string[] = [];
  const fake = {
    forMember: async () => rows.filter((row) => !removed.includes(row.id)),
    count: async () => rows.length,
    add: async () => {},
    remove: async () => true,
    removeGone: async (id: string) => {
      removed.push(id);
    },
    touch: async (id: string) => {
      touched.push(id);
    },
  } as unknown as PostgresPushSubscriptionStore;
  return { fake, removed, touched };
}

const device = (id: string): PushSubscriptionRow => ({
  id,
  // A real push service's host: the channel sends to no other (T-1880). The sender is scripted.
  endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
  p256dh: 'p',
  auth: 'a',
});

describe('vapidSettingsFromEnv', () => {
  it('refuses a channel without its keys or its subject, naming the variable', () => {
    expect(() => vapidSettingsFromEnv({})).toThrow(/VAPID_PUBLIC_KEY/);
    expect(() =>
      vapidSettingsFromEnv({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }),
    ).toThrow(/VAPID_SUBJECT/);
    expect(() =>
      vapidSettingsFromEnv({
        VAPID_PUBLIC_KEY: 'pub',
        VAPID_PRIVATE_KEY: 'priv',
        VAPID_SUBJECT: 'admin@example.test',
      }),
    ).toThrow(/VAPID_SUBJECT/);
    expect(
      vapidSettingsFromEnv({
        VAPID_PUBLIC_KEY: ' pub ',
        VAPID_PRIVATE_KEY: 'priv',
        VAPID_SUBJECT: 'mailto:admin@example.test',
      }),
    ).toEqual({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:admin@example.test' });
  });
});

describe('WebPushChannel', () => {
  const push = {
    userId: 'u',
    title: 'Stadiomind',
    body: 'ada sent you a friend request.',
    url: '/en/u/ada',
  };

  it('sends the sentence and the route to every device the member registered', async () => {
    const sent: { endpoint: string; payload: string }[] = [];
    const { fake, touched } = store([device('d1'), device('d2')]);
    const channel = new WebPushChannel('pub', fake, async (subscription, payload) => {
      sent.push({ endpoint: subscription.endpoint, payload });
    });
    await channel.send(push);
    expect(sent.map((s) => s.endpoint)).toEqual([
      'https://fcm.googleapis.com/fcm/send/d1',
      'https://fcm.googleapis.com/fcm/send/d2',
    ]);
    expect(JSON.parse(sent[0]!.payload)).toEqual(
      push.userId ? { title: 'Stadiomind', body: push.body, url: push.url } : null,
    );
    expect(touched).toEqual(['d1', 'd2']);
    expect(channel.provider).toBe('webpush');
    expect(channel.publicKey).toBe('pub');
  });

  it('removes a device whose service says it is gone, and still counts the others as sent', async () => {
    const { fake, removed } = store([device('gone'), device('here')]);
    const channel = new WebPushChannel('pub', fake, async (subscription) => {
      if (subscription.endpoint.endsWith('/gone')) throw new PushServiceError(410, 'Gone');
    });
    await expect(channel.send(push)).resolves.toBeUndefined();
    expect(removed).toEqual(['gone']);
  });

  it('never sends to an address that is not a push service, and removes that device (T-1880)', async () => {
    const elsewhere = (id: string, endpoint: string): PushSubscriptionRow => ({
      ...device(id),
      endpoint,
    });
    const sent: string[] = [];
    const { fake, removed, touched } = store([
      elsewhere('internal', 'https://10.0.0.5/hook'),
      device('here'),
      elsewhere('other', 'https://push.example/other'),
    ]);
    const channel = new WebPushChannel('pub', fake, async (subscription) => {
      sent.push(subscription.endpoint);
    });
    await expect(channel.send(push)).resolves.toBeUndefined();
    expect(sent).toEqual(['https://fcm.googleapis.com/fcm/send/here']);
    expect(removed).toEqual(['internal', 'other']);
    expect(touched).toEqual(['here']);

    // A member with no other device has none: the notice is skipped, not failed.
    const only = store([elsewhere('only', 'https://169.254.169.254/latest/')]);
    await expect(
      new WebPushChannel('pub', only.fake, async (subscription) => {
        sent.push(subscription.endpoint);
      }).send(push),
    ).rejects.toBeInstanceOf(NoRecipient);
    expect(only.removed).toEqual(['only']);
    expect(sent).toHaveLength(1);
  });

  it('answers gone for a subscription the caller keeps at such an address, unsent (T-1880)', async () => {
    const sent: string[] = [];
    const channel = new WebPushChannel('pub', store([]).fake, async (subscription) => {
      sent.push(subscription.endpoint);
    });
    const keys = { p256dh: 'p', auth: 'a' };
    const payload = { title: 't', body: 'b', url: 'calendar' };
    expect(await channel.sendTo({ endpoint: 'https://push.example/x', keys }, payload)).toBe(
      'gone',
    );
    expect(await channel.sendTo({ endpoint: 'https://127.0.0.1/x', keys }, payload)).toBe('gone');
    expect(sent).toEqual([]);
    expect(
      await channel.sendTo({ endpoint: 'https://web.push.apple.com/abc', keys }, payload),
    ).toBe('sent');
    expect(sent).toEqual(['https://web.push.apple.com/abc']);
  });

  it('is NoRecipient with no device, and a failure when every device failed', async () => {
    const none = store([]);
    await expect(
      new WebPushChannel('pub', none.fake, async () => {}).send(push),
    ).rejects.toBeInstanceOf(NoRecipient);
    const { fake } = store([device('d1')]);
    const broken = new WebPushChannel('pub', fake, async () => {
      throw new PushServiceError(500, 'push service down');
    });
    await expect(broken.send(push)).rejects.toThrow(/push service down/);
  });
});
