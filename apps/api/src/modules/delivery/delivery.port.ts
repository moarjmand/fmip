import type { DeliveryChannelState, DeliveryHealth } from '@fmip/contracts';

/**
 * Delivery behind one port (T-330, blueprint 12.2): e-mail and push, with a
 * provider chosen at deployment and **a deployment that has none saying so**.
 *
 * The `LogMailer` shape the product already uses (T-043, D-026), made
 * explicit: a channel is present or absent, `/health/delivery` reports
 * which, and an absent channel delivers nothing rather than appearing to.
 * A notification system that looks healthy and delivers nothing is the
 * worst failure in this phase, because nobody complains -- the people who
 * would complain never got the message.
 */
export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

export interface OutboundPush {
  userId: string;
  title: string;
  body: string;
  /** The deep link: the same subject the inbox already opens (T-324). */
  url: string;
}

export interface EmailChannel {
  readonly provider: string;
  send(mail: OutboundEmail): Promise<void>;
}

export interface PushChannel {
  readonly provider: string;
  send(push: OutboundPush): Promise<void>;
}

export interface OutboundDelivery {
  readonly email: EmailChannel | null;
  readonly push: PushChannel | null;
}

export const OUTBOUND_DELIVERY = Symbol('OUTBOUND_DELIVERY');

/** Both channels absent: what every deployment is until a provider is chosen. */
export class AbsentDelivery implements OutboundDelivery {
  readonly email = null;
  readonly push = null;
}

export function channelState(channel: { provider: string } | null): DeliveryChannelState {
  return channel === null
    ? { state: 'absent' }
    : { state: 'configured', provider: channel.provider };
}

export function describeDelivery(delivery: OutboundDelivery, now = new Date()): DeliveryHealth {
  return {
    checked_at: now.toISOString(),
    email: channelState(delivery.email),
    push: channelState(delivery.push),
    in_product_only: delivery.email === null && delivery.push === null,
  };
}

/** The provider names this build knows how to drive. None yet: the port precedes the provider. */
export const KNOWN_EMAIL_PROVIDERS: readonly string[] = [];
export const KNOWN_PUSH_PROVIDERS: readonly string[] = [];

/**
 * The delivery a deployment configured. `off` or unset is an honest
 * absence. A name this build cannot drive **refuses to start**: a typo in a
 * provider name that silently fell back to "absent" would be the silent
 * failure the port exists to prevent, discovered weeks later by nobody
 * having been told anything.
 */
export function deliveryFromEnv(env: NodeJS.ProcessEnv = process.env): OutboundDelivery {
  const email = (env.DELIVERY_EMAIL_PROVIDER ?? 'off').trim().toLowerCase();
  const push = (env.DELIVERY_PUSH_PROVIDER ?? 'off').trim().toLowerCase();
  if (email !== 'off' && email !== '' && !KNOWN_EMAIL_PROVIDERS.includes(email)) {
    throw new Error(
      `DELIVERY_EMAIL_PROVIDER=${email} is not a provider this build can drive` +
        ` (known: ${KNOWN_EMAIL_PROVIDERS.join(', ') || 'none'}; use "off" for none)`,
    );
  }
  if (push !== 'off' && push !== '' && !KNOWN_PUSH_PROVIDERS.includes(push)) {
    throw new Error(
      `DELIVERY_PUSH_PROVIDER=${push} is not a provider this build can drive` +
        ` (known: ${KNOWN_PUSH_PROVIDERS.join(', ') || 'none'}; use "off" for none)`,
    );
  }
  return new AbsentDelivery();
}
