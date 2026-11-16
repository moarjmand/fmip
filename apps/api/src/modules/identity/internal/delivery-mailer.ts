import { Injectable } from '@nestjs/common';
import { DeliveryService } from '../../delivery/delivery.service';
import { LogMailer, type Mailer, type OutboundMail } from './mailer';

/** Where a message that is not printed is noted: one line, never its text. */
export type MailNote = (line: string) => void;

/**
 * An address as a log may show it: the domain only. The part before `@` names
 * the member, and a log is read by more people and kept longer than an inbox.
 */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf('@');
  return at < 0 ? '***' : `***${address.slice(at)}`;
}

/**
 * Identity's mail through the delivery port (D-073): the verification and
 * the reset links leave by the same e-mail channel every notification uses.
 *
 * The message's text carries a link that signs a member in or resets their
 * password, so it is printed only where it is the whole point: a development
 * deployment with no e-mail channel at all, so local work and the E2E journey
 * still find the link (D-026). A send that failed, or a production deployment
 * with no channel, notes one line -- outcome, the address's domain, the
 * subject -- and never the text or the full address (T-1846). Never thrown:
 * the account exists and the member can ask again.
 */
@Injectable()
export class DeliveryMailer implements Mailer {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly fallback: Mailer = new LogMailer(),
    private readonly printable: boolean = process.env.NODE_ENV !== 'production',
    private readonly note: MailNote = (line) => process.stdout.write(line),
  ) {}

  async send(mail: OutboundMail): Promise<void> {
    const outcome = await this.delivery.deliver(mail, null);
    if (outcome.email === 'sent') return;
    if (outcome.email === 'absent' && this.printable) {
      await this.fallback.send(mail);
      return;
    }
    this.note(
      `[mail-not-sent] email=${outcome.email} to=${maskAddress(mail.to)} subject=${JSON.stringify(mail.subject)}\n`,
    );
  }
}
