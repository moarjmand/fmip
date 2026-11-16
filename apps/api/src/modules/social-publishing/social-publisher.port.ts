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

/**
 * Whether the stored key opens: never the key itself. `rejected`: it opens,
 * but the provider answered 401 to it -- a bad key, not a bad post (T-1836);
 * nothing is claimed until a person enters it again.
 */
export type SocialKeyState = 'set' | 'not_set' | 'unreadable' | 'rejected';

export type SocialPublisherReadiness =
  | { ready: true }
  | { ready: false; reason: 'not_set' | 'unreadable' | 'rejected' }
  | { ready: false; reason: 'paused'; until: Date }
  /** The network has no usable channel at the provider, or it could not be looked up. */
  | { ready: false; reason: 'channel'; detail: string };

export interface SocialPublisher {
  readonly provider: string;
  /**
   * Whether a call now could post: a readable key, no pause the provider
   * asked for and, given a network, a usable channel for it -- asked before
   * a post is claimed, so nothing is claimed that cannot go out (T-1839).
   */
  readiness(now?: Date, network?: SocialNetwork): Promise<SocialPublisherReadiness>;
  /** The stored key's state, for the health answer and the console. */
  keyState(): Promise<SocialKeyState>;
  /** The pause the provider asked for (a 429), or null. */
  pausedUntil(now?: Date): Date | null;
  /** Posts one publication. Throws `SocialRefusal` when nothing was posted; anything else is unknown. */
  publish(post: SocialPublication): Promise<{ providerRef: string }>;
  /**
   * The stored key was entered or cleared (T-1836): forget everything learnt
   * with the old one -- the channels, a failed lookup's wait, a rejection --
   * so a key entered again is used at once.
   */
  keyChanged(): void;
}

/**
 * Nothing was posted: the one failure after which trying again cannot post
 * twice. Two kinds (T-1839, D-427 point 6 as amended):
 * - the provider refused **the post itself** (`new SocialRefusal(...)`): a
 *   refused input, a picture it could not fetch, a permission refused for the post
 *   -- a publishing error, which breaks the kind's clean run;
 * - nothing was **sent** (`SocialRefusal.beforeSend(...)`): no usable
 *   channel, the provider unreachable before the request left, a rate limit
 *   (with the pause it named), a text over the limit, no readable key, or a
 *   401 to the key (T-1836: the key's fault, whenever it is answered) -- not
 *   the post's fault: the slot is given back and the run kept.
 */
export class SocialRefusal extends Error {
  constructor(
    message: string,
    /** For a rate limit: how long the provider asked us to wait. */
    readonly retryAfterMs: number | null = null,
    /** True when the request for the post was never sent. */
    readonly beforeSend: boolean = false,
  ) {
    super(message);
    this.name = 'SocialRefusal';
  }

  /** Nothing was sent: the slot goes back and the kind's run is kept. */
  static beforeSend(message: string, retryAfterMs: number | null = null): SocialRefusal {
    return new SocialRefusal(message, retryAfterMs, true);
  }
}

export const SOCIAL_PUBLISHER = Symbol('SOCIAL_PUBLISHER');
