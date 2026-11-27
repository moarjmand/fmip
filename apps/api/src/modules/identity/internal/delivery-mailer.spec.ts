import { describe, expect, it } from 'vitest';
import { AbsentDelivery, type OutboundDelivery } from '../../delivery/delivery.port';
import { DeliveryService } from '../../delivery/delivery.service';
import { DeliveryMailer, maskAddress } from './delivery-mailer';
import { CaptureMailer } from './mailer';

/**
 * Identity's mail through the delivery port (D-073): sent by the e-mail
 * channel where there is one, printed by the fallback only in development
 * with no channel, a failed send noted without its text (T-1846), never thrown.
 */
const mail = { to: 'ada@example.test', subject: 'Verify', text: 'Open the link.' };

describe('DeliveryMailer', () => {
  it('falls back to printing where the deployment has no channel', async () => {
    const fallback = new CaptureMailer();
    const mailer = new DeliveryMailer(new DeliveryService(new AbsentDelivery()), fallback);
    // Printed is not delivered: the outcome identity records says so (T-1967).
    await expect(mailer.send(mail)).resolves.toBe('absent');
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
    await expect(
      new DeliveryMailer(new DeliveryService(channels), fallback).send(mail),
    ).resolves.toBe('sent');
    expect(sent).toEqual([mail]);
    expect(fallback.sent).toEqual([]);
  });

  const broken: OutboundDelivery = {
    email: {
      provider: 'broken',
      send: async () => {
        throw new Error('Invalid login: 534-5.7.9 Please log in with your web browser');
      },
    },
    push: null,
  };
  const linkMail = {
    to: 'ada.lovelace@example.test',
    subject: 'Confirm your address',
    text: 'Open https://stadiomind.test/en/verify-email?token=s3cr3t-t0ken-value to confirm.',
  };

  it('notes a failed send without its link or full address, and does not throw (T-1846)', async () => {
    const fallback = new CaptureMailer();
    const lines: string[] = [];
    await expect(
      new DeliveryMailer(new DeliveryService(broken), fallback, true, (line) =>
        lines.push(line),
      ).send(linkMail),
    ).resolves.toBe('failed');
    expect(fallback.sent).toEqual([]);
    expect(lines).toEqual([
      '[mail-not-sent] email=failed to=***@example.test subject="Confirm your address"\n',
    ]);
    const logged = lines.join('');
    expect(logged).not.toContain('s3cr3t-t0ken-value');
    expect(logged).not.toContain('https://');
    expect(logged).not.toContain('ada.lovelace');
  });

  it('never prints the text in production, even with no channel (T-1846)', async () => {
    const fallback = new CaptureMailer();
    const lines: string[] = [];
    await new DeliveryMailer(new DeliveryService(new AbsentDelivery()), fallback, false, (line) =>
      lines.push(line),
    ).send(linkMail);
    expect(fallback.sent).toEqual([]);
    expect(lines).toEqual([
      '[mail-not-sent] email=absent to=***@example.test subject="Confirm your address"\n',
    ]);
  });
});

describe('maskAddress', () => {
  it('keeps only the domain', () => {
    expect(maskAddress('ada@example.test')).toBe('***@example.test');
    expect(maskAddress('a@b@example.test')).toBe('***@example.test');
    expect(maskAddress('no-at-sign')).toBe('***');
  });
});
