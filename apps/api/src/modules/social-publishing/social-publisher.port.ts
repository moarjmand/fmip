import type { SocialNetwork } from '@fmip/contracts';

/**
 * Where a social post goes out (T-1837, D-427 point 10), behind one port.
 *
 * Modelled on `ChannelPublisher` (channel-post) but separate from it: that
 * one posts plain text to one channel configured from the environment; this
 * one posts a text with a picture to a network, answers the network's
 * reference, and reads its key from the database, encrypted. The rest of the
 * module knows nothing of the provider: Buffer is `internal/buffer-publisher.ts`.
 *
 * Three outcomes, kept apart because they decide what the job may do next:
 * - an answer with a reference: published;
 * - `SocialRefusal`: the provider answered and posted nothing -- the post may
 *   be tried again at a later slot while it is valid;
 * - anything else thrown: nothing is known (a timeout after sending, a 5xx,
 *   a dropped connection, an answer that cannot be read) -- the post is
 *   `unknown`, keeps its slot, and only a person settles it.
 */

/** One post as it goes out: the frozen text and the public address of its card. */
export interface SocialPublication {
  network: SocialNetwork;
  text: string;
  /** The card's public address (`/social-card/<id>/card.png`); the provider fetches it. */
  imageUrl: string;
}

/** Whether the stored key opens: never the key itself. */
export type SocialKeyState = 'set' | 'not_set' | 'unreadable';

export type SocialPublisherReadiness =
  | { ready: true }
  | { ready: false; reason: 'not_set' | 'unreadable' }
  | { ready: false; reason: 'paused'; until: Date };

export interface SocialPublisher {
  readonly provider: string;
  /** Whether a call now could post: a readable key, and no pause the provider asked for. */
  readiness(now?: Date): Promise<SocialPublisherReadiness>;
  /** The stored key's state, for the health answer and the console. */
  keyState(): Promise<SocialKeyState>;
  /** The pause the provider asked for (a 429), or null. */
  pausedUntil(now?: Date): Date | null;
  /** Posts one publication. Throws `SocialRefusal` when nothing was posted; anything else is unknown. */
  publish(post: SocialPublication): Promise<{ providerRef: string }>;
}

/**
 * The provider answered and posted nothing: a refused input, a missing or
 * disconnected channel, an unauthorised key, a rate limit (with the pause it
 * named), or a step before the post was ever sent. The one failure after
 * which trying again cannot post twice.
 */
export class SocialRefusal extends Error {
  constructor(
    message: string,
    /** For a rate limit: how long the provider asked us to wait. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'SocialRefusal';
  }
}

export const SOCIAL_PUBLISHER = Symbol('SOCIAL_PUBLISHER');
