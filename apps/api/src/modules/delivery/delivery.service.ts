import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import type { DeliveryHealth } from '@fmip/contracts';
import type { PushState } from '@fmip/contracts';
import {
  NoRecipient,
  OUTBOUND_DELIVERY,
  type OutboundDelivery,
  type OutboundEmail,
  type OutboundPush,
  describeDelivery,
} from './delivery.port';
import { PostgresPushSubscriptionStore } from './internal/push-subscriptions';
import { WebPushChannel } from './internal/webpush';

/** What happened on one channel: absent, sent, failed, or skipped because this member has nowhere to receive on it. */
export type ChannelOutcome = 'absent' | 'sent' | 'failed' | 'skipped';

/** What happened to one notification on each channel. Absence is an outcome, not silence. */
export interface DeliveryOutcome {
  email: ChannelOutcome;
  push: ChannelOutcome;
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

  constructor(
    @Inject(OUTBOUND_DELIVERY) private readonly outbound: OutboundDelivery,
    // Optional so the service can be built by hand around a scripted port; the
    // module always provides the store, and without it a member has no devices.
    @Optional()
    @Inject(PostgresPushSubscriptionStore)
    private readonly subscriptions: PostgresPushSubscriptionStore | null = null,
  ) {}

  // --- a member's devices (D-074) ---------------------------------------

  /** What the settings page needs: whether push exists, the key to subscribe with, and how many devices this member has. */
  async pushState(userId: string): Promise<PushState> {
    const devices = this.subscriptions === null ? 0 : await this.subscriptions.count(userId);
    const email = this.outbound.email !== null;
    const channel = this.outbound.push;
    if (channel instanceof WebPushChannel) {
      return { state: 'configured', public_key: channel.publicKey, email, devices };
    }
    return { state: 'absent', email, devices };
  }

  registerDevice(
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent: string | null,
  ): Promise<void> {
    if (this.subscriptions === null) throw new Error('no subscription store');
    return this.subscriptions.add(userId, subscription, userAgent);
  }

  async removeDevice(userId: string, endpoint: string): Promise<boolean> {
    if (this.subscriptions === null) return false;
    return this.subscriptions.remove(userId, endpoint);
  }

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
  ): Promise<ChannelOutcome> {
    if (channel === null || item === null) return 'absent';
    try {
      await channel.send(item);
      return 'sent';
    } catch (error) {
      // The channel is there; this member has no device on it. Not a fault.
      if (error instanceof NoRecipient) return 'skipped';
      // The event that caused this already happened; a footnote must not undo it.
      this.log.error(
        `delivery.${name}_failed provider=${channel.provider}`,
        error instanceof Error ? error.stack : String(error),
      );
      return 'failed';
    }
  }
}
