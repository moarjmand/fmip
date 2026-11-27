import { createTransport } from 'nodemailer';
import {
  type EmailChannel,
  type OutboundEmail,
  SendFailed,
  type SendFailureDetail,
} from '../delivery.port';

/**
 * The e-mail channel (T-330, D-073): SMTP, which every transactional e-mail
 * service speaks and no vendor owns, so the deployment chooses the service
 * and this build does not. `SMTP_URL` is the whole connection
 * (`smtps://user:pass@host:465`, or `smtp://` with STARTTLS on 587) and
 * `DELIVERY_EMAIL_FROM` is the sender every message carries; a channel named
 * without either refuses to start, because a configured channel that cannot
 * send is the failure the port exists to prevent.
 *
 * The transport is injected so a spec can capture every message; nothing
 * connects until the first send, so building the channel is free.
 */
export interface SmtpSettings {
  url: string;
  from: string;
}

/** The one method this channel uses of nodemailer's transporter. */
export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

export function smtpSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpSettings {
  const url = (env.SMTP_URL ?? '').trim();
  const from = (env.DELIVERY_EMAIL_FROM ?? '').trim();
  if (!/^smtps?:\/\//.test(url)) {
    throw new Error(
      'DELIVERY_EMAIL_PROVIDER=smtp needs SMTP_URL (smtps://user:pass@host:465, or smtp://host:587 for STARTTLS); a configured channel that cannot send is not allowed to start',
    );
  }
  if (from === '') {
    throw new Error(
      'DELIVERY_EMAIL_PROVIDER=smtp needs DELIVERY_EMAIL_FROM, the address every message is sent from (e.g. "Stadiomind <no-reply@your-domain>")',
    );
  }
  return { url, from };
}

export class SmtpEmailChannel implements EmailChannel {
  readonly provider = 'smtp';

  constructor(
    private readonly transport: MailTransport,
    private readonly from: string,
  ) {}

  static fromSettings(settings: SmtpSettings): SmtpEmailChannel {
    return new SmtpEmailChannel(createTransport(settings.url), settings.from);
  }

  /** Sends one message; a refusal is thrown as `SendFailed`, its cause stated without an address (T-1967). */
  async send(mail: OutboundEmail): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      });
    } catch (error) {
      throw new SendFailed(describeSmtpError(error));
    }
  }
}

/** The longest reply a log line carries; a provider's reply is a sentence or two. */
const REASON_MAX = 300;

/**
 * Text from the SMTP service or nodemailer, as a log may show it: every
 * address cut to its domain (a reply to `RCPT TO` names the recipient, an
 * `Invalid sender` names the sender), a URL's user and password removed,
 * the lines of a multi-line reply joined, and the whole kept short.
 */
export function redactSmtpText(text: string): string {
  const flat = text
    .replace(/\b(smtps?|https?):\/\/[^\s/@]+@/gi, '$1://***@')
    .replace(/[^\s<>"'(),;:/[\]@]+@([A-Za-z0-9.-]+)/g, '***@$1')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > REASON_MAX ? `${flat.slice(0, REASON_MAX - 3)}...` : flat;
}

/**
 * Nodemailer's error, reduced to what states the cause (T-1967): its `code`,
 * the reply code, the command the service answered cut to its verb (so no
 * argument after it -- an address, an encoded credential -- can follow), and
 * the reply, or the message when the service sent none (a refused connection,
 * a timeout), redacted.
 */
export function describeSmtpError(error: unknown): SendFailureDetail {
  const raw = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown;
    responseCode?: unknown;
    command?: unknown;
    response?: unknown;
    message?: unknown;
  };
  const code =
    typeof raw.code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(raw.code) ? raw.code : null;
  const responseCode =
    typeof raw.responseCode === 'number' && Number.isInteger(raw.responseCode)
      ? raw.responseCode
      : null;
  const verb =
    typeof raw.command === 'string'
      ? /^[A-Z][A-Z0-9-]*(?: (?:TO|FROM|PLAIN|LOGIN|XOAUTH2|CRAM-MD5))?/.exec(raw.command)
      : null;
  const text =
    typeof raw.response === 'string' && raw.response.trim() !== ''
      ? raw.response
      : typeof raw.message === 'string'
        ? raw.message
        : String(error);
  return {
    code,
    responseCode,
    command: verb === null ? null : verb[0],
    reason: redactSmtpText(text),
  };
}
