import { describe, expect, it } from 'vitest';
import { AbsentDelivery, deliveryFromEnv, describeDelivery } from './delivery.port';
import { DeliveryService } from './delivery.service';

/**
 * The port's honest half (T-330): with no provider, both channels are
 * absent and say so; a provider name this build cannot drive stops the
 * process instead of silently becoming "absent"; delivering into absence is
 * an outcome, not an exception and not a success.
 */
describe('deliveryFromEnv', () => {
  it('is absent when nothing is configured, and when both are off', () => {
    for (const env of [{}, { DELIVERY_EMAIL_PROVIDER: 'off', DELIVERY_PUSH_PROVIDER: 'off' }]) {
      const delivery = deliveryFromEnv(env);
      expect(delivery).toBeInstanceOf(AbsentDelivery);
      expect(describeDelivery(delivery)).toMatchObject({
        email: { state: 'absent' },
        push: { state: 'absent' },
        in_product_only: true,
      });
    }
  });

  it('refuses to start on a provider this build cannot drive, naming the variable', () => {
    expect(() => deliveryFromEnv({ DELIVERY_EMAIL_PROVIDER: 'sendgrid' })).toThrow(
      /DELIVERY_EMAIL_PROVIDER=sendgrid/,
    );
    expect(() => deliveryFromEnv({ DELIVERY_PUSH_PROVIDER: 'fcm' })).toThrow(
      /DELIVERY_PUSH_PROVIDER=fcm/,
    );
  });
});

describe('DeliveryService', () => {
  it('reports absence on both channels rather than throwing or pretending', async () => {
    const service = new DeliveryService(new AbsentDelivery());
    const outcome = await service.deliver(
      { to: 'a@example.test', subject: 'x', text: 'y' },
      { userId: 'u', title: 't', body: 'b', url: '/en/notifications' },
    );
    expect(outcome).toEqual({ email: 'absent', push: 'absent' });
    expect(service.describe().in_product_only).toBe(true);
  });

  it('sends where a channel exists and records a failure without throwing', async () => {
    const sent: string[] = [];
    const service = new DeliveryService({
      email: {
        provider: 'capture',
        send: async (mail) => {
          sent.push(mail.to);
        },
      },
      push: {
        provider: 'broken',
        send: async () => {
          throw new Error('gateway down');
        },
      },
    });
    const outcome = await service.deliver(
      { to: 'a@example.test', subject: 'x', text: 'y' },
      { userId: 'u', title: 't', body: 'b', url: '/en/notifications' },
    );
    expect(outcome).toEqual({ email: 'sent', push: 'failed' });
    expect(sent).toEqual(['a@example.test']);
    expect(service.describe()).toMatchObject({
      email: { state: 'configured', provider: 'capture' },
      push: { state: 'configured', provider: 'broken' },
      in_product_only: false,
    });
  });
});
