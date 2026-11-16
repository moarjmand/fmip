import { createHash } from 'node:crypto';
import type { SocialNetwork } from '@fmip/contracts';
import {
  type SocialKeyState,
  type SocialPublication,
  type SocialPublisher,
  type SocialPublisherReadiness,
  SocialRefusal,
} from '../social-publisher.port';
import { type SecretBox, credentialAad } from './secret-box';
import { fitsNetwork } from './social-rules';

/**
 * Buffer behind the social publisher port (T-1837, D-427 point 10): the only
 * file in the product that knows Buffer. `fetch` only, no dependency, the key
 * read from `social_credential` and opened here and nowhere else.
 *
 * What Buffer's documentation says (read 2026-11-16, developers.buffer.com):
 * - One GraphQL endpoint, `POST https://api.buffer.com`, `Authorization:
 *   Bearer <API key>` (examples/create-image-post, examples/get-channels).
 *   The API is open on every plan, Free included, with a key from
 *   publish.buffer.com/settings/api (buffer.com/resources/buffer-api-is-here,
 *   2026-05-27).
 * - `createPost(input: CreatePostInput!)` answers the union
 *   `PostActionPayload`: `PostActionSuccess { post { id } }` or one of
 *   `NotFoundError`, `UnauthorizedError`, `UnexpectedError`,
 *   `RestProxyError`, `LimitReachedError`, `InvalidInputError`, each a
 *   `MutationError { message }` (types/PostActionPayload, guides/error-handling).
 * - `CreatePostInput`: `channelId`, `text`, `schedulingType` (`automatic`:
 *   Buffer's workers publish it), `mode: ShareMode` (`addToQueue`,
 *   `customScheduled`, `shareNext`, `shareNow`), `assets: [{ image: { url } }]`,
 *   `metadata.instagram { type: PostType (post, ...), shouldShareToFeed }`
 *   (reference: CreatePostInput, InstagramPostMetadataInput, PostType).
 * - Channels: `account { organizations { id } }`, then
 *   `channels(input: { organizationId })` with `id`, `service` (`twitter`,
 *   `instagram`, ...), `isDisconnected`, `isLocked`, `isQueuePaused`
 *   (examples/get-organizations, examples/get-channels, types/Channel, types/Service).
 * - Errors: GraphQL answers HTTP 200 with `errors[].extensions.code` --
 *   `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `UNEXPECTED`,
 *   `RATE_LIMIT_EXCEEDED` (guides/error-handling).
 * - Rate limits, shared by every key of the account: Free 150 requests a 15
 *   minutes, 600 a day, 1,000 a channel a month. Over a limit: HTTP 429 with
 *   `Retry-After` (seconds) and `RateLimit` (`t` = seconds to reset), body
 *   `{"errors":[{"extensions":{"code":"RATE_LIMIT_EXCEEDED","window":"15m"}}]}`;
 *   a 429 costs no quota (guides/api-limits).
 * - Media: the address must be public, direct (no redirect or preview page)
 *   and stable; Buffer fetches it when the post goes out, and a failed fetch
 *   is a `MutationError` ("Failed to fetch image dimensions: Not Found")
 *   (guides/hosting-media).
 * - Text: X 280 characters on a free X account (links 23); Instagram 2,196,
 *   UTF-16 units, a line break counting 2 (guides/character-limits). Both
 *   are `fitsNetwork` in `social-rules.ts`, held at drafting and on an edit;
 *   a text over them is refused here before anything is asked.
 *
 * What is ours, not Buffer's: Buffer's Free plan has 3 channels and a
 * 10-post queue a channel (buffer.com pricing, not in the API docs), so a
 * post is sent with `shareNow` at its slot, one at a time, and the queue is
 * never filled ahead. One request at a time, at most one every two seconds;
 * a 15-second timeout; a 429 is a refusal at the pause it names, and nothing
 * is asked until it has passed. The channel for a network is looked up
 * (at most hourly) rather than configured: exactly one connected, unlocked
 * channel of that service, or a refusal.
 *
 * Assumed, not documented: that `shareNow` publishes at once (the enum lists
 * it without a description); that a top-level error with no code, or a code
 * not listed above, may follow a post having been made (so it is unknown);
 * and that `PostActionSuccess` means Buffer took the post -- a send that
 * fails later inside Buffer is not seen here, and a person settles it from
 * Buffer's own page.
 *
 * The key is never in an error, a log line or an answer: every message from
 * below is scrubbed of it and cut short.
 */

export const BUFFER_ENDPOINT = 'https://api.buffer.com';
export const BUFFER_TIMEOUT_MS = 15_000;
export const BUFFER_MIN_GAP_MS = 2_000;
export const BUFFER_CHANNELS_TTL_MS = 60 * 60 * 1000;
/** A 429 that names no pause: wait out Buffer's shortest window. */
export const BUFFER_DEFAULT_PAUSE_MS = 15 * 60 * 1000;
export const BUFFER_PROVIDER = 'buffer';
/** A failed channel lookup is not tried again for this long (Buffer's 600 requests a day). */
export const BUFFER_LOOKUP_RETRY_MS = 15 * 60 * 1000;

/** Our networks as Buffer's `Service` names them. */
export const BUFFER_SERVICE: Readonly<Record<SocialNetwork, string>> = {
  x: 'twitter',
  instagram: 'instagram',
};

/** Top-level error codes after which nothing was created: the request was refused before it ran. */
const REFUSING_CODES = new Set([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMIT_EXCEEDED',
  'GRAPHQL_PARSE_FAILED',
  'GRAPHQL_VALIDATION_FAILED',
  'BAD_USER_INPUT',
  'BAD_REQUEST',
]);

/** `createPost`'s typed errors that say the post was not taken. Any other is unknown. */
const REFUSING_TYPES = new Set([
  'InvalidInputError',
  'LimitReachedError',
  'NotFoundError',
  'UnauthorizedError',
]);

const CREATE_POST = `mutation FmipCreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id } }
    ... on MutationError { message }
  }
}`;

const ORGANIZATIONS = `query FmipOrganizations { account { organizations { id } } }`;

const CHANNELS = `query FmipChannels($input: ChannelsInput!) {
  channels(input: $input) { id service isDisconnected isLocked isQueuePaused }
}`;

/** The encrypted key as stored; opened only here. */
export interface StoredCredential {
  id: string;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

export interface SocialCredentialReader {
  credential(provider: string): Promise<StoredCredential | null>;
}

export interface BufferOptions {
  endpoint?: string;
  timeoutMs?: number;
  minGapMs?: number;
  channelsTtlMs?: number;
  /** The clock and the wait, for the tests. */
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface GraphAnswer {
  status: number;
  headers: Headers;
  body: {
    data?: Record<string, unknown> | null;
    errors?: { message?: string; extensions?: { code?: string } }[];
  } | null;
}

interface BufferChannel {
  id: string;
  service: string;
  isDisconnected: boolean;
  isLocked: boolean;
  isQueuePaused: boolean;
}

export class BufferPublisher implements SocialPublisher {
  readonly provider = BUFFER_PROVIDER;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly minGapMs: number;
  private readonly channelsTtlMs: number;
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Every publish runs after the one before it: one request at a time. */
  private serial: Promise<unknown> = Promise.resolve();
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private pausedTill: number | null = null;
  private channels: { fingerprint: string; at: number; list: BufferChannel[] } | null = null;
  /**
   * When the channels last failed to be read with a key: not asked again
   * before `BUFFER_LOOKUP_RETRY_MS` with that key; another key, or
   * `keyChanged`, asks at once (T-1836).
   */
  private lookupFailed: { at: number; message: string; fingerprint: string } | null = null;
  /** A key Buffer answered 401 to (by its fingerprint): not used again until another is entered (T-1836). */
  private rejectedKey: string | null = null;

  constructor(
    private readonly credentials: SocialCredentialReader,
    private readonly box: SecretBox | null,
    private readonly fetchImpl: typeof fetch = fetch,
    options: BufferOptions = {},
  ) {
    this.endpoint = options.endpoint ?? BUFFER_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? BUFFER_TIMEOUT_MS;
    this.minGapMs = options.minGapMs ?? BUFFER_MIN_GAP_MS;
    this.channelsTtlMs = options.channelsTtlMs ?? BUFFER_CHANNELS_TTL_MS;
    this.clock = options.clock ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  pausedUntil(now: Date = new Date(this.clock())): Date | null {
    return this.pausedTill !== null && this.pausedTill > now.getTime()
      ? new Date(this.pausedTill)
      : null;
  }

  async keyState(): Promise<SocialKeyState> {
    const opened = await this.readKey();
    if (opened.state === 'set' && this.rejectedKey === fingerprintOf(opened.key)) return 'rejected';
    return opened.state;
  }

  /** The key was entered or cleared: the channels, a failed lookup's wait and a rejection are forgotten. */
  keyChanged(): void {
    this.channels = null;
    this.lookupFailed = null;
    this.rejectedKey = null;
  }

  async readiness(
    now: Date = new Date(this.clock()),
    network?: SocialNetwork,
  ): Promise<SocialPublisherReadiness> {
    const until = this.pausedUntil(now);
    if (until !== null) return { ready: false, reason: 'paused', until };
    const opened = await this.readKey();
    if (opened.state !== 'set') return { ready: false, reason: opened.state };
    if (this.rejectedKey === fingerprintOf(opened.key)) return { ready: false, reason: 'rejected' };
    if (network === undefined) return { ready: true };
    // The channel, before anything is claimed (T-1839): cached for an hour, so
    // this costs Buffer two requests an hour at most.
    const check = this.serial.then(() => this.channelFor(network, opened.key));
    this.serial = check.catch(() => undefined);
    try {
      await check;
      return { ready: true };
    } catch (error) {
      const paused = this.pausedUntil();
      if (paused !== null) return { ready: false, reason: 'paused', until: paused };
      const message = error instanceof Error ? error.message : String(error);
      return { ready: false, reason: 'channel', detail: this.scrub(message, opened.key) };
    }
  }

  publish(post: SocialPublication): Promise<{ providerRef: string }> {
    const run = this.serial.then(() => this.publishNow(post));
    this.serial = run.catch(() => undefined);
    return run;
  }

  private async publishNow(post: SocialPublication): Promise<{ providerRef: string }> {
    const until = this.pausedUntil();
    if (until !== null) {
      throw SocialRefusal.beforeSend(
        `buffer asked for a pause until ${until.toISOString()}`,
        until.getTime() - this.clock(),
      );
    }
    if (!/^https?:\/\/[^\s/]+\/\S+$/.test(post.imageUrl)) {
      throw SocialRefusal.beforeSend('the card address is not an absolute web address');
    }
    if (!fitsNetwork(post.text, post.network)) {
      throw SocialRefusal.beforeSend(`the text is longer than Buffer takes for ${post.network}`);
    }
    let opened: Awaited<ReturnType<BufferPublisher['readKey']>>;
    try {
      opened = await this.readKey();
    } catch (error) {
      // Nothing was sent: the stored key could not even be read.
      throw SocialRefusal.beforeSend(
        `before posting, the key could not be read: ${describe(error)}`,
      );
    }
    if (opened.state !== 'set') {
      throw SocialRefusal.beforeSend(
        opened.state === 'not_set' ? 'no Buffer key is set' : 'the Buffer key is unreadable',
      );
    }
    const key = opened.key;
    if (this.rejectedKey === fingerprintOf(key)) {
      throw SocialRefusal.beforeSend('buffer rejected the key: enter it again');
    }
    const channelId = await this.channelFor(post.network, key);

    let answer: GraphAnswer;
    try {
      answer = await this.request(key, CREATE_POST, {
        input: {
          channelId,
          text: post.text,
          schedulingType: 'automatic',
          mode: 'shareNow',
          assets: [{ image: { url: post.imageUrl } }],
          ...(post.network === 'instagram'
            ? { metadata: { instagram: { type: 'post', shouldShareToFeed: true } } }
            : {}),
        },
      });
    } catch (error) {
      // No address or no listener: the request never left, so nothing was posted.
      if (NEVER_SENT.has(causeCode(error) ?? '')) {
        throw SocialRefusal.beforeSend(`buffer unreachable: ${this.scrub(describe(error), key)}`);
      }
      // Sent, or perhaps sent: a timeout or a dropped connection says nothing of the outcome.
      throw new Error(`buffer did not answer: ${this.scrub(describe(error), key)}`);
    }
    return this.outcome(answer, key);
  }

  /** What `createPost`'s answer means: a reference, a refusal (thrown), or unknown (thrown). */
  private outcome(answer: GraphAnswer, key: string): { providerRef: string } {
    this.refuseOnRateLimit(answer);
    this.refuseOnBadKey(answer, key);
    const { status, body } = answer;
    if (status >= 500 || status === 408) {
      throw new Error(`buffer answered ${status}: ${this.messageOf(answer, key)}`);
    }
    if (status >= 400) {
      this.channels = null;
      throw new SocialRefusal(`buffer refused (${status}): ${this.messageOf(answer, key)}`);
    }
    if (body === null) throw new Error(`buffer answered ${status} with no readable body`);
    const result = (body.data?.createPost ?? null) as {
      __typename?: string;
      post?: { id?: unknown };
      message?: string;
    } | null;
    if (result === null) {
      const codes = (body.errors ?? []).map((e) => e.extensions?.code ?? '');
      if (codes.length > 0 && codes.every((c) => REFUSING_CODES.has(c))) {
        this.channels = null;
        throw new SocialRefusal(
          `buffer refused (${codes.join(',')}): ${this.messageOf(answer, key)}`,
        );
      }
      throw new Error(`buffer answered with no post: ${this.messageOf(answer, key)}`);
    }
    if (result.__typename === 'PostActionSuccess') {
      const id = result.post?.id;
      if (typeof id === 'string' && id.trim() !== '') return { providerRef: id };
      throw new Error('buffer took the post but named no reference');
    }
    const message = this.scrub(result.message ?? 'no message', key);
    if (result.__typename !== undefined && REFUSING_TYPES.has(result.__typename)) {
      this.channels = null;
      throw new SocialRefusal(`buffer refused (${result.__typename}): ${message}`);
    }
    throw new Error(`buffer answered ${result.__typename ?? 'an unnamed result'}: ${message}`);
  }

  /**
   * The one connected, unlocked channel of the network's service. Every
   * failure here is before sending, so it is a refusal.
   */
  private async channelFor(network: SocialNetwork, key: string): Promise<string> {
    const fingerprint = fingerprintOf(key);
    const now = this.clock();
    if (
      this.channels === null ||
      this.channels.fingerprint !== fingerprint ||
      now - this.channels.at >= this.channelsTtlMs
    ) {
      const failed = this.lookupFailed;
      if (
        failed !== null &&
        failed.fingerprint === fingerprint &&
        now - failed.at < BUFFER_LOOKUP_RETRY_MS
      ) {
        throw SocialRefusal.beforeSend(failed.message);
      }
      try {
        this.channels = { fingerprint, at: now, list: await this.listChannels(key) };
        this.lookupFailed = null;
      } catch (error) {
        const refusal =
          error instanceof SocialRefusal
            ? error
            : SocialRefusal.beforeSend(
                `before posting, the Buffer channels could not be read: ${this.scrub(describe(error), key)}`,
              );
        // A rate limit has its own pause; anything else waits out the retry window.
        if (refusal.retryAfterMs === null && this.rejectedKey !== fingerprint)
          this.lookupFailed = { at: now, message: refusal.message, fingerprint };
        throw refusal;
      }
    }
    const service = BUFFER_SERVICE[network];
    const usable = this.channels.list.filter(
      (c) => c.service === service && !c.isDisconnected && !c.isLocked,
    );
    if (usable.length === 0) {
      throw SocialRefusal.beforeSend(`no connected, unlocked ${service} channel on Buffer`);
    }
    if (usable.length > 1) {
      throw SocialRefusal.beforeSend(
        `more than one ${service} channel on Buffer: which one is not ours to guess`,
      );
    }
    if (usable[0]!.isQueuePaused) {
      throw SocialRefusal.beforeSend(`the ${service} channel's queue is paused on Buffer`);
    }
    return usable[0]!.id;
  }

  private async listChannels(key: string): Promise<BufferChannel[]> {
    const orgs = this.lookupData(await this.request(key, ORGANIZATIONS, {}), key);
    const account = orgs.account as { organizations?: { id?: unknown }[] } | null | undefined;
    const ids = (account?.organizations ?? [])
      .map((o) => o.id)
      .filter((id): id is string => typeof id === 'string');
    const list: BufferChannel[] = [];
    for (const organizationId of ids) {
      const data = this.lookupData(
        await this.request(key, CHANNELS, { input: { organizationId } }),
        key,
      );
      for (const c of (data.channels as Partial<BufferChannel>[] | null) ?? []) {
        if (typeof c.id !== 'string' || typeof c.service !== 'string') continue;
        list.push({
          id: c.id,
          service: c.service,
          isDisconnected: c.isDisconnected === true,
          isLocked: c.isLocked === true,
          isQueuePaused: c.isQueuePaused === true,
        });
      }
    }
    return list;
  }

  private lookupData(answer: GraphAnswer, key: string): Record<string, unknown> {
    this.refuseOnRateLimit(answer);
    this.refuseOnBadKey(answer, key);
    const data = answer.body?.data ?? null;
    if (answer.status !== 200 || data === null || (answer.body?.errors?.length ?? 0) > 0) {
      throw SocialRefusal.beforeSend(
        `before posting, Buffer refused the channel lookup (${answer.status}): ${this.messageOf(answer, key)}`,
      );
    }
    return data;
  }

  /** A 429, or Buffer's rate-limit code: the pause it names is kept, and the call refused. */
  private refuseOnRateLimit(answer: GraphAnswer): void {
    const limited =
      answer.status === 429 ||
      (answer.body?.errors ?? []).some((e) => e.extensions?.code === 'RATE_LIMIT_EXCEEDED');
    if (!limited) return;
    const pause = pauseOf(answer.headers, this.clock());
    this.pausedTill = this.clock() + pause;
    this.channels = null;
    throw SocialRefusal.beforeSend(
      `buffer rate limit: paused for ${Math.round(pause / 1000)} s`,
      pause,
    );
  }

  /**
   * A 401, or GraphQL's `UNAUTHORIZED`: Buffer refused the key, not the post
   * (T-1836). Whenever it comes -- the channel lookup or `createPost` -- the
   * key is marked rejected (the console says "re-enter it") and the call is a
   * refusal before sending: the slot goes back and the kind's run is kept,
   * since no post of ours was judged. Nothing is claimed until a key is
   * entered again (`keyChanged`, or another key read from the database).
   */
  private refuseOnBadKey(answer: GraphAnswer, key: string): void {
    const rejected =
      answer.status === 401 ||
      (answer.body?.errors ?? []).some((e) => e.extensions?.code === 'UNAUTHORIZED');
    if (!rejected) return;
    this.rejectedKey = fingerprintOf(key);
    this.channels = null;
    this.lookupFailed = null;
    throw SocialRefusal.beforeSend(
      `buffer rejected the key (${answer.status}): ${this.messageOf(answer, key)}`,
    );
  }

  private async request(
    key: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<GraphAnswer> {
    const wait = this.lastRequestAt + this.minGapMs - this.clock();
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = this.clock();
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = (await response.json().catch(() => null)) as GraphAnswer['body'];
    return { status: response.status, headers: response.headers, body };
  }

  private async readKey(): Promise<
    { state: 'set'; key: string } | { state: 'not_set' | 'unreadable' }
  > {
    const row = await this.credentials.credential(BUFFER_PROVIDER);
    if (row === null) return { state: 'not_set' };
    if (this.box === null) return { state: 'unreadable' };
    try {
      const key = this.box.open(row, credentialAad(BUFFER_PROVIDER, row.id));
      return key.trim() === '' ? { state: 'unreadable' } : { state: 'set', key };
    } catch {
      return { state: 'unreadable' };
    }
  }

  private messageOf(answer: GraphAnswer, key: string): string {
    const messages = (answer.body?.errors ?? [])
      .map((e) => e.message ?? e.extensions?.code ?? '')
      .filter((m) => m !== '');
    return this.scrub(messages.length > 0 ? messages.join('; ') : 'no message', key);
  }

  /** The key out of any text from below, and the text cut short. */
  private scrub(text: string, key: string): string {
    const clean = key === '' ? text : text.split(key).join('<key>');
    return clean.length > 300 ? `${clean.slice(0, 300)}...` : clean;
  }
}

/** The pause a 429 names: `Retry-After` (seconds or a date), else `RateLimit`'s `t`, else 15 minutes. */
export function pauseOf(headers: Headers, now: number = Date.now()): number {
  const retry = headers.get('retry-after');
  if (retry !== null) {
    if (/^\d+$/.test(retry.trim())) return Number(retry.trim()) * 1000;
    const at = Date.parse(retry);
    if (!Number.isNaN(at) && at > now) return at - now;
  }
  const limit = headers.get('ratelimit');
  const t = limit === null ? null : /(?:^|[;,\s])t=(\d+)/.exec(limit);
  if (t !== null && t !== undefined) return Number(t[1]) * 1000;
  return BUFFER_DEFAULT_PAUSE_MS;
}

/** A key's fingerprint, to tell keys apart without keeping one. */
const fingerprintOf = (key: string): string => createHash('sha256').update(key).digest('hex');

/** Connection failures that happen before a byte of the request is sent. */
const NEVER_SENT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']);

function causeCode(error: unknown): string | null {
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : null;
  return cause !== null && typeof cause === 'object' && 'code' in cause ? String(cause.code) : null;
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  const code =
    cause !== null && typeof cause === 'object' && 'code' in cause
      ? ` (${String(cause.code)})`
      : '';
  return `${error.name}: ${error.message}${code}`;
}
