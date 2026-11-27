/**
 * Outbound e-mail as a port. The identity service composes messages; how they
 * leave the process is a deployment decision: the delivery port's e-mail
 * channel (D-073, `DeliveryMailer`). `LogMailer` prints a message whole, which
 * is what local development wants -- the verification link in the terminal --
 * and is used only in development with no channel (D-430, T-1846).
 */

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
}

/**
 * What became of one message (T-1967): `sent` by the e-mail channel,
 * `failed` there, `absent` when no channel carried it (printed in
 * development), `skipped` when the channel had nowhere to send it. Identity
 * records it on the message's token, so a sign-up, verification or reset
 * mail that keeps failing is counted, not only logged.
 */
export type MailOutcome = 'sent' | 'failed' | 'absent' | 'skipped';

export interface Mailer {
  send(mail: OutboundMail): Promise<MailOutcome>;
}

export const MAILER = Symbol('MAILER');

export class LogMailer implements Mailer {
  constructor(
    private readonly write: (line: string) => void = (line) => process.stdout.write(line),
  ) {}

  async send(mail: OutboundMail): Promise<MailOutcome> {
    this.write(`[mail] to=${mail.to} subject=${JSON.stringify(mail.subject)}\n${mail.text}\n\n`);
    return 'absent';
  }
}

/** Keeps every message in memory. For tests. */
export class CaptureMailer implements Mailer {
  readonly sent: OutboundMail[] = [];

  async send(mail: OutboundMail): Promise<MailOutcome> {
    this.sent.push(mail);
    return 'sent';
  }
}
