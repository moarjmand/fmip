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

  /**
   * The connection's limits in seconds, not nodemailer's minutes (two to
   * connect, ten idle): a sign-up or a reset waits for its mail, and a dead
   * SMTP server must not hold a member's request (T-1967). `SMTP_URL`'s own
   * query parameters still win.
   */
  static readonly TIMEOUTS = {
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  } as const;

  static fromSettings(settings: SmtpSettings): SmtpEmailChannel {
    return new SmtpEmailChannel(
      createTransport({ url: settings.url, ...SmtpEmailChannel.TIMEOUTS }),
      settings.from,
    );
  }

  /**
   * Sends one message. A refusal is thrown as `SendFailed`, its cause stated
   * without an address or a token (T-1967); one that concerns only this
   * recipient (no such mailbox) says so, so it is not read as the channel's.
   */
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

/**
 * The most of a reply that is read at all. Nodemailer accepts a reply of up
 * to 1 MB; nothing below ever runs over more than this.
 */
const READ_MAX = 500;
/** The longest reply a log line carries; a provider's reply is a sentence or two. */
const REASON_MAX = 300;

/** A URL's host: whatever follows its last `@` (a password may hold `/`), up to the first character no host has. */
function hostOf(rest: string): string {
  const afterUser = rest.slice(rest.lastIndexOf('@') + 1);
  return /^[A-Za-z0-9.-]*/.exec(afterUser)?.[0] ?? '';
}

/** A whitespace-free run that holds an address (`@`, or `%40` encoded) keeps its opening brackets and its domain only. */
function maskAddressRun(run: string): string {
  const at = run.lastIndexOf('@');
  const encoded = run.toLowerCase().lastIndexOf('%40');
  if (at < 0 && encoded < 0) return run;
  const domain = at > encoded ? run.slice(at + 1) : run.slice(encoded + 3);
  const opening = /^[<(["']*/.exec(run)?.[0] ?? '';
  return `${opening}***@${domain}`;
}

/**
 * Text from the SMTP service or nodemailer, as a log may show it (T-1967):
 * - read only up to `READ_MAX` characters, a run cut there dropped, before
 *   any pattern runs;
 * - every URL cut to its scheme and host (its user, password, path, query
 *   and fragment can carry a credential or a reset or verification link's
 *   token);
 * - every address cut to its domain, quoted, encoded or not (a reply to
 *   `RCPT TO` names the recipient, an `Invalid sender` the sender);
 * - every run of 24 or more token characters (a link's token, an encoded
 *   credential) replaced by `***`;
 * - the lines of a multi-line reply joined, and the whole kept short.
 */
export function redactSmtpText(text: string): string {
  let head = text;
  if (head.length > READ_MAX) {
    head = head.slice(0, READ_MAX);
    const lastSpace = Math.max(
      head.lastIndexOf(' '),
      head.lastIndexOf('\n'),
      head.lastIndexOf('\t'),
    );
    head = lastSpace > 0 ? `${head.slice(0, lastSpace)} ...` : '...';
  }
  const flat = head
    .replace(
      /\b([A-Za-z][A-Za-z0-9+.-]{0,15}):\/\/(\S*)/g,
      (_url, scheme: string, rest: string) => `${scheme}://${hostOf(rest)}`,
    )
    .replace(/"[^"\r\n]{0,64}"@/g, '***@')
    .split(/(\s+)/)
    .map(maskAddressRun)
    .join('')
    .replace(/[A-Za-z0-9_+/=-]{24,}/g, '***')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > REASON_MAX ? `${flat.slice(0, REASON_MAX - 3)}...` : flat;
}

/**
 * The command a reply answered, cut to its verb (`AUTH PLAIN`, `RCPT TO`), so
 * no argument after it -- an address, an encoded credential -- can follow.
 */
function commandVerb(command: unknown): string | null {
  if (typeof command !== 'string') return null;
  const verb = /^[A-Z][A-Z0-9-]{0,15}(?: (?:TO|FROM|PLAIN|LOGIN|XOAUTH2|CRAM-MD5))?/.exec(
    command.slice(0, 40),
  );
  return verb === null ? null : verb[0];
}

/**
 * Whether nodemailer's error refuses only this recipient (T-1967): the
 * service answered `RCPT TO` with an address or mailbox status (`5.1.x`,
 * `5.2.x`, or a bare 550, 551 or 553), or nodemailer found the address
 * malformed. A policy refusal (`5.7.x`), a refused sender or login, or a
 * connection that failed is the channel's.
 */
export function refusesRecipientOnly(error: unknown): boolean {
  const raw = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown;
    command?: unknown;
    response?: unknown;
    responseCode?: unknown;
    message?: unknown;
  };
  if (raw.code !== 'EENVELOPE') return false;
  const verb = commandVerb(raw.command);
  if (verb === 'API') {
    return typeof raw.message === 'string' && raw.message.startsWith('Invalid recipient');
  }
  if (verb !== 'RCPT TO') return false;
  const reply = typeof raw.response === 'string' ? raw.response.slice(0, READ_MAX) : '';
  const status = /\b[45]\.(\d{1,3})\.\d{1,3}\b/.exec(reply);
  if (status !== null) return status[1] === '1' || status[1] === '2';
  return raw.responseCode === 550 || raw.responseCode === 551 || raw.responseCode === 553;
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
  const text =
    typeof raw.response === 'string' && raw.response.trim() !== ''
      ? raw.response
      : typeof raw.message === 'string'
        ? raw.message
        : String(error);
  return {
    scope: refusesRecipientOnly(error) ? 'recipient' : 'channel',
    code,
    responseCode,
    command: commandVerb(raw.command),
    reason: redactSmtpText(text),
  };
}
