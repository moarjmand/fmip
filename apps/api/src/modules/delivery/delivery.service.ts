import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { DeliveryHealth } from '@fmip/contracts';
import {
  OUTBOUND_DELIVERY,
  type OutboundDelivery,
  type OutboundEmail,
  type OutboundPush,
  describeDelivery,
} from './delivery.port';

/** What happened to one notification on each channel. Absence is an outcome, not silence. */
export interface DeliveryOutcome {
  email: 'absent' | 'sent' | 'failed';
  push: 'absent' | 'sent' | 'failed';
}

/**
 * The one place a notification leaves the building (T-330). Everything
 * upstream -- the inbox, the caps, the quiet hours, the mutes -- has already
 * decided the member should be told; this decides only whether anything
 * can carry it, and says so when nothing can.
 */
@Injectable()
export class DeliveryService implements OnModuleInit {
  private readonly log = new Logger('Delivery');

  constructor(@Inject(OUTBOUND_DELIVERY) private readonly outbound: OutboundDelivery) {}

  onModuleInit(): void {
    const state = this.describe();
    // Stated at boot, in the log every operator reads first, because the
    // absence is the normal state of a new deployment and must never be
    // mistaken for a delivery that quietly works.
    this.log.log(
      `delivery email=${state.email.state} push=${state.push.state}` +
        (state.in_product_only ? ' -- notifications stay in the product' : ''),
      { event: 'delivery.channels', email: state.email, push: state.push },
    );
  }

  describe(): DeliveryHealth {
    return describeDelivery(this.outbound);
  }

  /** Carries a notification on every channel that exists; reports each one. */
  async deliver(email: OutboundEmail | null, push: OutboundPush | null): Promise<DeliveryOutcome> {
    return {
      email: await this.on(this.outbound.email, email, 'email'),
      push: await this.on(this.outbound.push, push, 'push'),
    };
  }

  private async on<T>(
    channel: { provider: string; send(item: T): Promise<void> } | null,
    item: T | null,
    name: 'email' | 'push',
  ): Promise<'absent' | 'sent' | 'failed'> {
    if (channel === null || item === null) return 'absent';
    try {
      await channel.send(item);
      return 'sent';
    } catch (error) {
      // The event that caused this already happened; a footnote must not undo it.
      this.log.error(
        `delivery.${name}_failed provider=${channel.provider}`,
        error instanceof Error ? error.stack : String(error),
      );
      return 'failed';
    }
  }
}
