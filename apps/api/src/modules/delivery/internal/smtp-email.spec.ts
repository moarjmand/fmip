import { describe, expect, it } from 'vitest';
import { type MailTransport, SmtpEmailChannel, smtpSettingsFromEnv } from './smtp-email';

/**
 * The SMTP channel (D-073): named without its connection or its sender it
 * refuses to start; with both, every message goes out from the configured
 * sender with the recipient, subject and text the port handed it.
 */
describe('smtpSettingsFromEnv', () => {
  it('refuses a channel without its connection or its sender, naming the variable', () => {
    expect(() => smtpSettingsFromEnv({})).toThrow(/SMTP_URL/);
    expect(() => smtpSettingsFromEnv({ SMTP_URL: 'mail.example:587' })).toThrow(/SMTP_URL/);
    expect(() => smtpSettingsFromEnv({ SMTP_URL: 'smtps://u:p@mail.example:465' })).toThrow(
      /DELIVERY_EMAIL_FROM/,
    );
  });

  it('takes an smtp or smtps URL and a sender', () => {
    expect(
      smtpSettingsFromEnv({
        SMTP_URL: ' smtp://mail.example:587 ',
        DELIVERY_EMAIL_FROM: 'FMIP <no-reply@example.test>',
      }),
    ).toEqual({ url: 'smtp://mail.example:587', from: 'FMIP <no-reply@example.test>' });
  });
});

describe('SmtpEmailChannel', () => {
  it('sends from the configured sender with what the port handed it', async () => {
    const sent: unknown[] = [];
    const transport: MailTransport = {
      sendMail: async (message) => {
        sent.push(message);
      },
    };
    const channel = new SmtpEmailChannel(transport, 'FMIP <no-reply@example.test>');
    expect(channel.provider).toBe('smtp');
    await channel.send({ to: 'ada@example.test', subject: 'Hello', text: 'A line.' });
    expect(sent).toEqual([
      {
        from: 'FMIP <no-reply@example.test>',
        to: 'ada@example.test',
        subject: 'Hello',
        text: 'A line.',
      },
    ]);
  });

  it('is built from settings without connecting', () => {
    const channel = SmtpEmailChannel.fromSettings({
      url: 'smtps://u:p@mail.example:465',
      from: 'FMIP <no-reply@example.test>',
    });
    expect(channel.provider).toBe('smtp');
  });
});
