import { createTransport } from 'nodemailer';
import type { EmailChannel, OutboundEmail } from '../delivery.port';

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
      'DELIVERY_EMAIL_PROVIDER=smtp needs DELIVERY_EMAIL_FROM, the address every message is sent from (e.g. "FMIP <no-reply@your-domain>")',
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

  async send(mail: OutboundEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  }
}
