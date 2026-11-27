import { describe, expect, it } from 'vitest';
import { SendFailed } from '../delivery.port';
import {
  type MailTransport,
  SmtpEmailChannel,
  describeSmtpError,
  redactSmtpText,
  smtpSettingsFromEnv,
} from './smtp-email';

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
        DELIVERY_EMAIL_FROM: 'Stadiomind <no-reply@example.test>',
      }),
    ).toEqual({ url: 'smtp://mail.example:587', from: 'Stadiomind <no-reply@example.test>' });
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
    const channel = new SmtpEmailChannel(transport, 'Stadiomind <no-reply@example.test>');
    expect(channel.provider).toBe('smtp');
    await channel.send({ to: 'ada@example.test', subject: 'Hello', text: 'A line.' });
    expect(sent).toEqual([
      {
        from: 'Stadiomind <no-reply@example.test>',
        to: 'ada@example.test',
        subject: 'Hello',
        text: 'A line.',
      },
    ]);
  });

  it('is built from settings without connecting', () => {
    const channel = SmtpEmailChannel.fromSettings({
      url: 'smtps://u:p@mail.example:465',
      from: 'Stadiomind <no-reply@example.test>',
    });
    expect(channel.provider).toBe('smtp');
  });
});

/**
 * A refused send states its cause (T-1967): the next failure in the log names
 * the provider's code, reply code, command and reply -- never a credential,
 * never the recipient in full.
 */
describe('SmtpEmailChannel: a refused send', () => {
  const refusing = (error: unknown): MailTransport => ({
    sendMail: async () => {
      throw error;
    },
  });
  const mail = { to: 'ada.lovelace@example.test', subject: 'Hello', text: 'A link.' };

  it('throws SendFailed with the code, the reply code, the command and the reply', async () => {
    // The shape nodemailer gives a login the service refuses (Google's 534).
    const refusal = Object.assign(
      new Error('Invalid login: 534-5.7.9 Please log in with your web browser and then try again.'),
      {
        code: 'EAUTH',
        responseCode: 534,
        command: 'AUTH PLAIN',
        response:
          '534-5.7.9 Please log in with your web browser and then try again. For more\n534-5.7.9 information, go to\n534 5.7.9  https://support.google.com/mail/?p=WebLoginRequired x1-gsmtp',
      },
    );
    const channel = new SmtpEmailChannel(refusing(refusal), 'Stadiomind <no-reply@example.test>');
    const thrown = await channel.send(mail).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(SendFailed);
    const failed = thrown as SendFailed;
    expect(failed.detail).toEqual({
      code: 'EAUTH',
      responseCode: 534,
      command: 'AUTH PLAIN',
      reason:
        '534-5.7.9 Please log in with your web browser and then try again. For more 534-5.7.9 information, go to 534 5.7.9 https://support.google.com/mail/?p=WebLoginRequired x1-gsmtp',
    });
    expect(failed.message).toMatch(
      /^code=EAUTH response_code=534 command="AUTH PLAIN" reason="534-5\.7\.9 /,
    );
    // The provider's error is not carried along: its message can name the recipient.
    expect(failed.cause).toBeUndefined();
  });

  it('cuts a rejected recipient to its domain, in the reply and in the command', () => {
    const detail = describeSmtpError(
      Object.assign(new Error("Can't send mail - all recipients were rejected"), {
        code: 'EENVELOPE',
        responseCode: 550,
        command: 'RCPT TO:<ada.lovelace@example.test>',
        response: '550 5.1.1 <ada.lovelace@example.test>: Recipient address rejected',
      }),
    );
    expect(detail).toEqual({
      code: 'EENVELOPE',
      responseCode: 550,
      command: 'RCPT TO',
      reason: '550 5.1.1 <***@example.test>: Recipient address rejected',
    });
    expect(JSON.stringify(detail)).not.toContain('ada.lovelace');
  });

  it('states a connection that never answered by its message, and keeps no credential', () => {
    expect(
      describeSmtpError(
        Object.assign(new Error('connect ECONNREFUSED 192.0.2.1:587'), {
          code: 'ESOCKET',
          command: 'CONN',
        }),
      ),
    ).toEqual({
      code: 'ESOCKET',
      responseCode: null,
      command: 'CONN',
      reason: 'connect ECONNREFUSED 192.0.2.1:587',
    });
    const leaked = describeSmtpError(
      new Error('failed to reach smtps://sender%40example.test:s3cr3t-pass@mail.example:465'),
    );
    expect(leaked.reason).toBe('failed to reach smtps://***@mail.example:465');
    expect(leaked).toMatchObject({ code: null, responseCode: null, command: null });
    // An argument after a command's verb never reaches the log.
    expect(
      describeSmtpError(Object.assign(new Error('x'), { command: 'AUTH PLAIN AGFkYQBzM2NyM3Q=' }))
        .command,
    ).toBe('AUTH PLAIN');
    expect(describeSmtpError('a plain string').reason).toBe('a plain string');
  });

  it('keeps a long reply short', () => {
    expect(redactSmtpText(`421 ${'x'.repeat(1000)}`)).toHaveLength(300);
  });
});
