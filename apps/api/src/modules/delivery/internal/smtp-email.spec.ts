import { describe, expect, it } from 'vitest';
import { SendFailed } from '../delivery.port';
import {
  type MailTransport,
  SmtpEmailChannel,
  describeSmtpError,
  redactSmtpText,
  refusesRecipientOnly,
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
      scope: 'channel',
      code: 'EAUTH',
      responseCode: 534,
      command: 'AUTH PLAIN',
      reason:
        '534-5.7.9 Please log in with your web browser and then try again. For more 534-5.7.9 information, go to 534 5.7.9 https://support.google.com x1-gsmtp',
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
      scope: 'recipient',
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
      scope: 'channel',
      code: 'ESOCKET',
      responseCode: null,
      command: 'CONN',
      reason: 'connect ECONNREFUSED 192.0.2.1:587',
    });
    const leaked = describeSmtpError(
      new Error('failed to reach smtps://sender%40example.test:s3cr3t-pass@mail.example:465'),
    );
    expect(leaked.reason).toBe('failed to reach smtps://mail.example');
    expect(leaked).toMatchObject({ code: null, responseCode: null, command: null });
    // An argument after a command's verb never reaches the log.
    expect(
      describeSmtpError(Object.assign(new Error('x'), { command: 'AUTH PLAIN AGFkYQBzM2NyM3Q=' }))
        .command,
    ).toBe('AUTH PLAIN');
    expect(describeSmtpError('a plain string').reason).toBe('a plain string');
  });

  // A reset or verification link's token: 43 characters of base64url, a live credential until it expires.
  const TOKEN = 'Zq3xR8vT1mWbN4kLp0sYcH7dEaJ2fG9uQiO5nB6tUwV';

  it('cuts a reset link in a DATA refusal to its host, so the token never reaches the log', async () => {
    const refusal = Object.assign(new Error('Message failed'), {
      code: 'EMESSAGE',
      responseCode: 554,
      command: 'DATA',
      response: `554 5.7.1 Message rejected: URL https://web.example.test/en/reset-password?token=${TOKEN} is blocklisted`,
    });
    const failed = await new SmtpEmailChannel(refusing(refusal), 'no-reply@example.test')
      .send(mail)
      .then(
        () => null,
        (error: unknown) => error as SendFailed,
      );
    expect(failed?.detail).toEqual({
      scope: 'channel',
      code: 'EMESSAGE',
      responseCode: 554,
      command: 'DATA',
      reason: '554 5.7.1 Message rejected: URL https://web.example.test is blocklisted',
    });
    expect(failed?.message).not.toContain(TOKEN);
  });

  it('masks a token in the message fallback and a long token with no URL around it', () => {
    const fallback = describeSmtpError(
      Object.assign(new Error(`Message failed: 554 reset-password?token=${TOKEN}`), {
        code: 'EMESSAGE',
        command: 'DATA',
      }),
    );
    expect(fallback.reason).toBe('Message failed: 554 reset-password?***');
    expect(redactSmtpText(`535 5.7.8 credentials rejected for ${TOKEN}.`)).toBe(
      '535 5.7.8 credentials rejected for ***.',
    );
    // From 24 characters a run is a token; 23 is still a word.
    expect(redactSmtpText(`reply ${'A'.repeat(24)}`)).toBe('reply ***');
    expect(redactSmtpText(`reply ${'A'.repeat(23)}`)).toBe(`reply ${'A'.repeat(23)}`);
  });

  it('cuts every spelling of an address to its domain', () => {
    expect(redactSmtpText('550 5.1.1 <ada@übung.example> unknown')).toBe(
      '550 5.1.1 <***@übung.example> unknown',
    );
    expect(redactSmtpText('550 5.1.1 "ada lovelace"@example.test unknown')).toBe(
      '550 5.1.1 ***@example.test unknown',
    );
    expect(redactSmtpText('550 ada%40example.test unknown')).toBe('550 ***@example.test unknown');
    expect(redactSmtpText('550 ada/lovelace@example.test unknown')).toBe(
      '550 ***@example.test unknown',
    );
    expect(redactSmtpText('Invalid sender "Stadiomind <no-reply@example.test>"')).toBe(
      'Invalid sender "Stadiomind <***@example.test>"',
    );
    expect(redactSmtpText('failed smtps://user:pa/ss@mail.example:465 now')).toBe(
      'failed smtps://mail.example now',
    );
  });

  it('reads a huge reply in bounded time and keeps it short', () => {
    for (const huge of [
      'x'.repeat(20_000),
      `${'a@'.repeat(10_000)}`,
      `421 ${'word '.repeat(4_000)}`,
      'h'.repeat(1_000_000),
    ]) {
      const started = performance.now();
      const reason = redactSmtpText(huge);
      expect(performance.now() - started).toBeLessThan(250);
      expect(reason.length).toBeLessThanOrEqual(300);
    }
    expect(redactSmtpText(`421 ${'word '.repeat(200)}`)).toHaveLength(300);
  });

  it('tells a refusal of one recipient from a refusal of the channel', () => {
    const envelope = (command: string, responseCode: number, response: string, message = 'x') =>
      Object.assign(new Error(message), { code: 'EENVELOPE', command, responseCode, response });
    const atRcpt = (response: string) =>
      refusesRecipientOnly(envelope('RCPT TO', Number(response.slice(0, 3)), response));
    // The recipient's own mailbox: unknown, full, a multi-line reply, X.1.10.
    for (const reply of [
      '550 5.1.1 user unknown',
      '552 5.2.2 mailbox full',
      '550-5.1.1 The email account that you tried to reach does not exist',
      '553 5.1.3 bad destination address syntax',
      '550 5.1.10 recipient address has null MX',
    ]) {
      expect(atRcpt(reply), reply).toBe(true);
    }
    // The channel's, though answered at RCPT: no enhanced status, a sender
    // status (X.1.0, X.1.7, X.1.8), policy, or a number in the text that is
    // not where a status stands.
    for (const reply of [
      '550 relay not permitted',
      '550 authentication required',
      '450 4.1.8 sender domain does not resolve',
      '550 5.1.7 bad sender mailbox address syntax',
      '550 5.1.0 address rejected',
      '550 5.7.1 [192.0.2.1] blocked',
      '550 5.7.1 Relaying denied',
      '550 blocked, see 5.1.1 at example.test',
      '550 No such user here',
    ]) {
      expect(atRcpt(reply), reply).toBe(false);
    }
    expect(refusesRecipientOnly(envelope('MAIL FROM', 550, '550 5.1.1 sender unknown'))).toBe(
      false,
    );
    expect(refusesRecipientOnly(envelope('API', 0, '', 'Invalid recipient "ada@"'))).toBe(true);
    expect(refusesRecipientOnly(envelope('API', 0, '', 'No recipients defined'))).toBe(false);
    expect(
      refusesRecipientOnly(
        Object.assign(new Error('Invalid login'), { code: 'EAUTH', command: 'AUTH PLAIN' }),
      ),
    ).toBe(false);
  });

  it('gives the connection limits in seconds, not minutes', () => {
    expect(SmtpEmailChannel.TIMEOUTS).toEqual({
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  });
});
