import { describe, expect, it } from 'vitest';
import { AbsentDelivery, type OutboundDelivery } from '../../delivery/delivery.port';
import { DeliveryService } from '../../delivery/delivery.service';
import { DeliveryMailer } from './delivery-mailer';
import { CaptureMailer } from './mailer';

/**
 * Identity's mail through the delivery port (D-073): sent by the e-mail
 * channel where there is one, printed by the fallback where there is none
 * or the send failed, never thrown.
 */
const mail = { to: 'ada@example.test', subject: 'Verify', text: 'Open the link.' };

describe('DeliveryMailer', () => {
  it('falls back to printing where the deployment has no channel', async () => {
    const fallback = new CaptureMailer();
    const mailer = new DeliveryMailer(new DeliveryService(new AbsentDelivery()), fallback);
    await mailer.send(mail);
    expect(fallback.sent).toEqual([mail]);
  });

  it('sends by the channel and does not print when it is there', async () => {
    const sent: unknown[] = [];
    const channels: OutboundDelivery = {
      email: {
        provider: 'capture',
        send: async (message) => {
          sent.push(message);
        },
      },
      push: null,
    };
    const fallback = new CaptureMailer();
    await new DeliveryMailer(new DeliveryService(channels), fallback).send(mail);
    expect(sent).toEqual([mail]);
    expect(fallback.sent).toEqual([]);
  });

  it('prints instead of throwing when the channel fails', async () => {
    const channels: OutboundDelivery = {
      email: {
        provider: 'broken',
        send: async () => {
          throw new Error('connection refused');
        },
      },
      push: null,
    };
    const fallback = new CaptureMailer();
    await expect(
      new DeliveryMailer(new DeliveryService(channels), fallback).send(mail),
    ).resolves.toBeUndefined();
    expect(fallback.sent).toEqual([mail]);
  });
});
