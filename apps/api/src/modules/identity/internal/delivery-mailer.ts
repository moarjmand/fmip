import { Injectable } from '@nestjs/common';
import { DeliveryService } from '../../delivery/delivery.service';
import { LogMailer, type Mailer, type OutboundMail } from './mailer';

/**
 * Identity's mail through the delivery port (D-073): the verification and
 * the reset links leave by the same e-mail channel every notification uses,
 * and where the deployment has none they are printed as before (D-026), so
 * local development still finds the link in the terminal. A send the
 * channel reports as failed is logged by the port and printed here too,
 * never thrown: the account exists and the member can ask again.
 */
@Injectable()
export class DeliveryMailer implements Mailer {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly fallback: Mailer = new LogMailer(),
  ) {}

  async send(mail: OutboundMail): Promise<void> {
    const outcome = await this.delivery.deliver(mail, null);
    if (outcome.email !== 'sent') await this.fallback.send(mail);
  }
}
