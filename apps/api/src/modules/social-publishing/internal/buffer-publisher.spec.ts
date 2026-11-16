import { describe, expect, it } from 'vitest';
import { SocialRefusal, type SocialPublication } from '../social-publisher.port';
import {
  BUFFER_DEFAULT_PAUSE_MS,
  BufferPublisher,
  type BufferOptions,
  type StoredCredential,
  pauseOf,
} from './buffer-publisher';
import { SecretBox, credentialAad } from './secret-box';

/**
 * The Buffer adapter against a stubbed Buffer (`fetch` injected): no real
 * call, no real key. The stub answers Buffer's documented shapes (see the
 * adapter's header) and records every request.
 */

const SECRET = 'a-session-secret-of-at-least-32-characters';
const KEY = 'bf-test-key-9f8e7d6c5b4a';
const ROW = '00000000-0000-4000-8000-0000000000aa';
const box = new SecretBox(SECRET);

const stored = (key = KEY, sealer = box): StoredCredential => ({
  id: ROW,
  ...sealer.seal(key, credentialAad('buffer', ROW)),
});

const X: SocialPublication = {
  network: 'x',
  text: 'Arsenal v Chelsea: the model says 41.2% home',
  imageUrl: 'https://stadiomind.test/social-card/abc/card.png',
};
const IG: SocialPublication = { ...X, network: 'instagram' };

interface Seen {
  operation: string;
  variables: Record<string, unknown>;
  authorization: string | null;
}

type Reply = Response | (() => Response | Promise<Response>);

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const CHANNELS = [
  { id: 'ch-x', service: 'twitter', isDisconnected: false, isLocked: false, isQueuePaused: false },
  {
    id: 'ch-ig',
    service: 'instagram',
    isDisconnected: false,
    isLocked: false,
    isQueuePaused: false,
  },
  {
    id: 'ch-li',
    service: 'linkedin',
    isDisconnected: false,
    isLocked: false,
    isQueuePaused: false,
  },
];

const created = (id = 'post-1') =>
  json({ data: { createPost: { __typename: 'PostActionSuccess', post: { id } } } });

/** A stubbed Buffer: answers by operation, records each request. */
function stubBuffer(replies: { create?: Reply[]; organizations?: Reply; channels?: Reply } = {}): {
  fetch: typeof fetch;
  seen: Seen[];
} {
  const seen: Seen[] = [];
  const creates = [...(replies.create ?? [created()])];
  const answer = async (reply: Reply | undefined, fallback: () => Response) =>
    reply === undefined ? fallback() : typeof reply === 'function' ? reply() : reply.clone();
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    const operation = /(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1] ?? '?';
    const headers = new Headers(init?.headers);
    seen.push({
      operation,
      variables: body.variables,
      authorization: headers.get('authorization'),
    });
    if (operation === 'FmipOrganizations') {
      return answer(replies.organizations, () =>
        json({ data: { account: { organizations: [{ id: 'org-1' }] } } }),
      );
    }
    if (operation === 'FmipChannels') {
      return answer(replies.channels, () => json({ data: { channels: CHANNELS } }));
    }
    return answer(creates.length > 1 ? creates.shift() : creates[0], () => created());
  }) as typeof fetch;
  return { fetch: fetchImpl, seen };
}

/** A clock the tests move by hand; waits move it too. */
function fakeClock(start = Date.parse('2026-11-16T12:00:00Z')) {
  let now = start;
  const waits: number[] = [];
  return {
    clock: () => now,
    sleep: async (ms: number) => {
      waits.push(ms);
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
    waits,
  };
}

function publisher(
  fetchImpl: typeof fetch,
  options: BufferOptions = {},
  credential: StoredCredential | null = stored(),
  secretBox: SecretBox | null = box,
) {
  const time = fakeClock();
  return {
    time,
    buffer: new BufferPublisher({ credential: async () => credential }, secretBox, fetchImpl, {
      clock: time.clock,
      sleep: time.sleep,
      ...options,
    }),
  };
}

const failureOf = async (p: Promise<unknown>): Promise<Error> => {
  try {
    await p;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a failure');
};

describe('the Buffer publisher', () => {
  it("posts at once (shareNow, automatic) to the network's one channel, with the card, and answers Buffer's reference", async () => {
    const stub = stubBuffer({ create: [created('buf-123')] });
    const { buffer } = publisher(stub.fetch);
    expect(await buffer.publish(X)).toEqual({ providerRef: 'buf-123' });
    expect(stub.seen.map((s) => s.operation)).toEqual([
      'FmipOrganizations',
      'FmipChannels',
      'FmipCreatePost',
    ]);
    expect(stub.seen.every((s) => s.authorization === `Bearer ${KEY}`)).toBe(true);
    expect(stub.seen[1]!.variables).toEqual({ input: { organizationId: 'org-1' } });
    expect(stub.seen[2]!.variables).toEqual({
      input: {
        channelId: 'ch-x',
        text: X.text,
        schedulingType: 'automatic',
        mode: 'shareNow',
        assets: [{ image: { url: X.imageUrl } }],
      },
    });
  });

  it('names an Instagram post a feed post, and reads the channels once an hour', async () => {
    const stub = stubBuffer();
    const { buffer, time } = publisher(stub.fetch);
    await buffer.publish(IG);
    await buffer.publish(X);
    const create = stub.seen.filter((s) => s.operation === 'FmipCreatePost');
    expect(create[0]!.variables.input).toMatchObject({
      channelId: 'ch-ig',
      metadata: { instagram: { type: 'post', shouldShareToFeed: true } },
    });
    expect(create[1]!.variables.input).not.toHaveProperty('metadata');
    expect(stub.seen.filter((s) => s.operation === 'FmipChannels')).toHaveLength(1);
    time.advance(60 * 60 * 1000);
    await buffer.publish(X);
    expect(stub.seen.filter((s) => s.operation === 'FmipChannels')).toHaveLength(2);
  });

  it('asks one thing at a time, at most once every two seconds', async () => {
    let inFlight = 0;
    let most = 0;
    const inner = stubBuffer();
    const slow = (async (url: unknown, init?: RequestInit) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return inner.fetch(url as string, init);
    }) as typeof fetch;
    const { buffer, time } = publisher(slow);
    await Promise.all([buffer.publish(X), buffer.publish(IG), buffer.publish(X)]);
    expect(most).toBe(1);
    // 3 + 1 + 1 requests: every one after the first waited out the two seconds.
    expect(inner.seen).toHaveLength(5);
    expect(time.waits).toHaveLength(4);
    expect(time.waits.every((w) => w === 2000)).toBe(true);
  });

  describe('a refusal (nothing was posted)', () => {
    const refusals: [string, Parameters<typeof stubBuffer>[0]][] = [
      [
        'an invalid input',
        {
          create: [
            json({
              data: {
                createPost: { __typename: 'InvalidInputError', message: 'Text is required' },
              },
            }),
          ],
        },
      ],
      [
        "Buffer's limit",
        {
          create: [
            json({
              data: { createPost: { __typename: 'LimitReachedError', message: 'Queue full' } },
            }),
          ],
        },
      ],
      [
        'a key Buffer does not know',
        {
          create: [
            json({
              data: null,
              errors: [{ message: 'Not authorized', extensions: { code: 'UNAUTHORIZED' } }],
            }),
          ],
        },
      ],
      ['an HTTP 400', { create: [json({ errors: [{ message: 'bad' }] }, 400)] }],
      [
        'a picture Buffer could not fetch',
        {
          create: [
            json({
              data: {
                createPost: {
                  __typename: 'NotFoundError',
                  message: 'Failed to fetch image dimensions: Not Found',
                },
              },
            }),
          ],
        },
      ],
    ];
    for (const [name, replies] of refusals) {
      it(`for ${name}`, async () => {
        const { buffer } = publisher(stubBuffer(replies).fetch);
        expect(await failureOf(buffer.publish(X))).toBeInstanceOf(SocialRefusal);
      });
    }

    const lookups: [string, Parameters<typeof stubBuffer>[0]][] = [
      ['no channel of the network', { channels: json({ data: { channels: [CHANNELS[2]] } }) }],
      [
        'two channels of the network',
        { channels: json({ data: { channels: [CHANNELS[0], { ...CHANNELS[0], id: 'ch-x2' }] } }) },
      ],
      [
        'a disconnected channel',
        { channels: json({ data: { channels: [{ ...CHANNELS[0], isDisconnected: true }] } }) },
      ],
      [
        'a locked channel',
        { channels: json({ data: { channels: [{ ...CHANNELS[0], isLocked: true }] } }) },
      ],
      [
        'a paused queue',
        { channels: json({ data: { channels: [{ ...CHANNELS[0], isQueuePaused: true }] } }) },
      ],
      ['a lookup Buffer answered 500', { organizations: json({}, 500) }],
      [
        'a lookup that timed out',
        {
          organizations: () => {
            throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
          },
        },
      ],
    ];
    for (const [name, replies] of lookups) {
      it(`for ${name}, before anything is sent`, async () => {
        const stub = stubBuffer(replies);
        const { buffer } = publisher(stub.fetch);
        expect(await failureOf(buffer.publish(X))).toBeInstanceOf(SocialRefusal);
        expect(stub.seen.some((s) => s.operation === 'FmipCreatePost')).toBe(false);
      });
    }

    it('for a text over the network limit as Buffer counts it, without asking Buffer', async () => {
      const stub = stubBuffer();
      const { buffer } = publisher(stub.fetch);
      const caption = `${'a'.repeat(2090)}${'\n'.repeat(60)}`; // 2,150 characters, 2,210 for Buffer
      expect(await failureOf(buffer.publish({ ...IG, text: caption }))).toBeInstanceOf(
        SocialRefusal,
      );
      expect(stub.seen).toEqual([]);
    });

    it('for a key that cannot be read from the database, or a Buffer that cannot be reached', async () => {
      const stub = stubBuffer();
      const broken = new BufferPublisher(
        {
          credential: async () => {
            throw new Error('database down');
          },
        },
        box,
        stub.fetch,
        { sleep: async () => undefined },
      );
      expect(await failureOf(broken.publish(X))).toBeInstanceOf(SocialRefusal);
      for (const code of ['ENOTFOUND', 'ECONNREFUSED']) {
        const { buffer } = publisher(
          stubBuffer({
            create: [
              () => {
                throw new TypeError('fetch failed', { cause: { code } });
              },
            ],
          }).fetch,
        );
        const error = await failureOf(buffer.publish(X));
        expect(error).toBeInstanceOf(SocialRefusal);
        expect(error.message).toContain(code);
      }
      expect(stub.seen).toEqual([]);
    });

    it('with no key, an unreadable key, or no box, without asking Buffer', async () => {
      const stub = stubBuffer();
      for (const [credential, secretBox] of [
        [null, box],
        [stored(KEY, new SecretBox(`${SECRET}-other`)), box],
        [stored(), null],
      ] as const) {
        const { buffer } = publisher(stub.fetch, {}, credential, secretBox);
        expect(await failureOf(buffer.publish(X))).toBeInstanceOf(SocialRefusal);
      }
      expect(stub.seen).toEqual([]);
    });
  });

  describe('which refusals happened before sending (T-1839)', () => {
    it("marks Buffer's own refusal of the post as sent, and every refusal before the request as not", async () => {
      const refusedPost = stubBuffer({
        create: [
          json({
            data: { createPost: { __typename: 'InvalidInputError', message: 'Text is required' } },
          }),
        ],
      });
      const own = (await failureOf(
        publisher(refusedPost.fetch).buffer.publish(X),
      )) as SocialRefusal;
      expect(own.beforeSend).toBe(false);

      const before: [string, Parameters<typeof stubBuffer>[0], SocialPublication][] = [
        ['no channel', { channels: json({ data: { channels: [CHANNELS[2]] } }) }, IG],
        ['a 429', { create: [json({}, 429, { 'retry-after': '60' })] }, X],
        [
          'Buffer unreachable',
          {
            create: [
              () => {
                throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
              },
            ],
          },
          X,
        ],
        ['a text over the limit', {}, { ...IG, text: 'a'.repeat(2197) }],
      ];
      for (const [name, replies, post] of before) {
        const error = (await failureOf(
          publisher(stubBuffer(replies).fetch).buffer.publish(post),
        )) as SocialRefusal;
        expect([name, error.beforeSend]).toEqual([name, true]);
      }
    });

    it('says before any claim whether the network has a channel, and does not ask again for 15 minutes after a failed lookup', async () => {
      const onlyX = stubBuffer({ channels: json({ data: { channels: [CHANNELS[0]] } }) });
      const { buffer } = publisher(onlyX.fetch);
      expect(await buffer.readiness(undefined, 'x')).toEqual({ ready: true });
      expect(await buffer.readiness(undefined, 'instagram')).toMatchObject({
        ready: false,
        reason: 'channel',
        detail: expect.stringContaining('instagram'),
      });
      // Both answered from one lookup, cached.
      expect(onlyX.seen.map((s) => s.operation)).toEqual(['FmipOrganizations', 'FmipChannels']);
      // Without a network: the key and the pause only, no request.
      expect(await buffer.readiness()).toEqual({ ready: true });
      expect(onlyX.seen).toHaveLength(2);

      const down = stubBuffer({ organizations: json({}, 500) });
      const failing = publisher(down.fetch);
      expect(await failing.buffer.readiness(undefined, 'x')).toMatchObject({ reason: 'channel' });
      expect(await failing.buffer.readiness(undefined, 'x')).toMatchObject({ reason: 'channel' });
      expect(down.seen).toHaveLength(1);
      failing.time.advance(15 * 60 * 1000);
      await failing.buffer.readiness(undefined, 'x');
      expect(down.seen).toHaveLength(2);
    });
  });

  describe('the key entered again, and a key Buffer rejects (T-1836)', () => {
    it('asks for the channels at once after the key is entered or cleared, not after the 15-minute wait', async () => {
      const down = stubBuffer({ organizations: json({}, 500) });
      const { buffer } = publisher(down.fetch);
      expect(await buffer.readiness(undefined, 'x')).toMatchObject({ reason: 'channel' });
      expect(await buffer.readiness(undefined, 'x')).toMatchObject({ reason: 'channel' });
      expect(down.seen).toHaveLength(1);
      buffer.keyChanged();
      await buffer.readiness(undefined, 'x');
      expect(down.seen).toHaveLength(2);
    });

    it('waits only for the key that failed: another key from the database is asked at once', async () => {
      const down = stubBuffer({ organizations: json({}, 500) });
      let credential = stored();
      const time = fakeClock();
      const buffer = new BufferPublisher({ credential: async () => credential }, box, down.fetch, {
        clock: time.clock,
        sleep: time.sleep,
      });
      await buffer.readiness(undefined, 'x');
      expect(down.seen).toHaveLength(1);
      credential = stored(`${KEY}-new`);
      await buffer.readiness(undefined, 'x');
      expect(down.seen).toHaveLength(2);
    });

    const rejections: [string, Parameters<typeof stubBuffer>[0]][] = [
      ['an HTTP 401 to the post', { create: [json({ errors: [{ message: 'bad key' }] }, 401)] }],
      [
        "GraphQL's UNAUTHORIZED to the post",
        {
          create: [
            json({
              data: null,
              errors: [{ message: 'Not authorized', extensions: { code: 'UNAUTHORIZED' } }],
            }),
          ],
        },
      ],
      ['an HTTP 401 to the channel lookup', { organizations: json({}, 401) }],
    ];
    for (const [name, replies] of rejections) {
      it(`treats ${name} as the key's fault: refused before sending, and the key rejected until entered again`, async () => {
        const stub = stubBuffer(replies);
        const { buffer } = publisher(stub.fetch);
        const error = (await failureOf(buffer.publish(X))) as SocialRefusal;
        expect(error).toBeInstanceOf(SocialRefusal);
        expect(error.beforeSend).toBe(true);
        expect(error.message).toContain('rejected the key');
        expect(error.message).not.toContain(KEY);
        expect(await buffer.keyState()).toBe('rejected');
        expect(await buffer.readiness()).toEqual({ ready: false, reason: 'rejected' });
        // Nothing more is asked of Buffer with that key.
        const asked = stub.seen.length;
        expect(((await failureOf(buffer.publish(X))) as SocialRefusal).beforeSend).toBe(true);
        expect(stub.seen).toHaveLength(asked);
        // Entered again: used at once.
        buffer.keyChanged();
        expect(await buffer.keyState()).toBe('set');
        expect(await buffer.readiness()).toEqual({ ready: true });
      });
    }

    it("keeps Buffer's typed refusal of the post a refusal of the post, not of the key", async () => {
      const stub = stubBuffer({
        create: [
          json({ data: { createPost: { __typename: 'UnauthorizedError', message: 'no access' } } }),
        ],
      });
      const { buffer } = publisher(stub.fetch);
      expect(((await failureOf(buffer.publish(X))) as SocialRefusal).beforeSend).toBe(false);
      expect(await buffer.keyState()).toBe('set');
    });
  });

  describe('an unknown outcome (perhaps posted: never a refusal)', () => {
    const unknowns: [string, Reply][] = [
      ['a 500', json({ errors: [{ message: 'boom' }] }, 500)],
      ['a 502 from a proxy', new Response('<html>Bad gateway</html>', { status: 502 })],
      [
        "Buffer's unexpected error",
        json({ data: { createPost: { __typename: 'UnexpectedError', message: 'oops' } } }),
      ],
      [
        'a REST proxy error',
        json({ data: { createPost: { __typename: 'RestProxyError', message: 'upstream' } } }),
      ],
      [
        'a top-level UNEXPECTED',
        json({ data: null, errors: [{ message: 'x', extensions: { code: 'UNEXPECTED' } }] }),
      ],
      ['an unreadable body', new Response('not json', { status: 200 })],
      [
        'a success with no reference',
        json({ data: { createPost: { __typename: 'PostActionSuccess', post: {} } } }),
      ],
      [
        'a dropped connection',
        () => {
          throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
        },
      ],
    ];
    for (const [name, reply] of unknowns) {
      it(`for ${name}`, async () => {
        const { buffer } = publisher(stubBuffer({ create: [reply] }).fetch);
        const error = await failureOf(buffer.publish(X));
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(SocialRefusal);
      });
    }

    it('for a timeout after sending (15 s, here shortened)', async () => {
      const inner = stubBuffer();
      const hanging = (async (url: unknown, init?: RequestInit) => {
        const op = /(?:query|mutation)\s+(\w+)/.exec(String(init?.body))?.[1];
        if (op !== 'FmipCreatePost') return inner.fetch(url as string, init);
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        });
      }) as typeof fetch;
      const { buffer } = publisher(hanging, { timeoutMs: 20 });
      const error = await failureOf(buffer.publish(X));
      expect(error).not.toBeInstanceOf(SocialRefusal);
      expect(error.message).toMatch(/did not answer/);
    });
  });

  describe('a rate limit', () => {
    it('is a refusal at the pause Buffer names, and nothing is asked until it has passed', async () => {
      const stub = stubBuffer({
        create: [
          json(
            {
              errors: [
                {
                  message: 'Too many requests from this client. Please try again later.',
                  extensions: { code: 'RATE_LIMIT_EXCEEDED', window: '15m' },
                },
              ],
            },
            429,
            { 'retry-after': '753' },
          ),
          created('after-pause'),
        ],
      });
      const { buffer, time } = publisher(stub.fetch);
      const error = await failureOf(buffer.publish(X));
      expect(error).toBeInstanceOf(SocialRefusal);
      expect((error as SocialRefusal).retryAfterMs).toBe(753_000);
      expect(await buffer.readiness()).toMatchObject({ ready: false, reason: 'paused' });
      const asked = stub.seen.length;
      expect(await failureOf(buffer.publish(X))).toBeInstanceOf(SocialRefusal);
      expect(stub.seen).toHaveLength(asked);
      time.advance(753_000);
      expect(await buffer.readiness()).toEqual({ ready: true });
      expect(await buffer.publish(X)).toEqual({ providerRef: 'after-pause' });
    });

    it('reads the pause from Retry-After, a date, RateLimit, or else waits out the window', () => {
      const now = Date.parse('2026-11-16T12:00:00Z');
      expect(pauseOf(new Headers({ 'retry-after': '60' }), now)).toBe(60_000);
      expect(pauseOf(new Headers({ 'retry-after': 'Mon, 16 Nov 2026 12:02:00 GMT' }), now)).toBe(
        120_000,
      );
      expect(pauseOf(new Headers({ ratelimit: '"15m";r=0;t=300' }), now)).toBe(300_000);
      expect(pauseOf(new Headers(), now)).toBe(BUFFER_DEFAULT_PAUSE_MS);
    });

    it("is also Buffer's code in a 200 answer", async () => {
      const stub = stubBuffer({
        create: [json({ data: null, errors: [{ extensions: { code: 'RATE_LIMIT_EXCEEDED' } }] })],
      });
      const { buffer } = publisher(stub.fetch);
      const error = await failureOf(buffer.publish(X));
      expect(error).toBeInstanceOf(SocialRefusal);
      expect((error as SocialRefusal).retryAfterMs).toBe(BUFFER_DEFAULT_PAUSE_MS);
    });
  });

  it('never carries the key in an error, whatever Buffer or the network says', async () => {
    const echoes: Reply[] = [
      json({
        data: null,
        errors: [{ message: `bad key ${KEY}`, extensions: { code: 'FORBIDDEN' } }],
      }),
      json({ errors: [{ message: `server saw ${KEY}` }] }, 500),
      json({ data: { createPost: { __typename: 'UnexpectedError', message: `key=${KEY}` } } }),
      () => {
        throw new Error(`connect to https://api.buffer.com with Bearer ${KEY} failed`);
      },
    ];
    for (const reply of echoes) {
      const { buffer } = publisher(stubBuffer({ create: [reply] }).fetch);
      const error = await failureOf(buffer.publish(X));
      expect(error.message).not.toContain(KEY);
      expect(error.message).toContain('<key>');
      expect(JSON.stringify(error)).not.toContain(KEY);
    }
  });

  it('says whether the key is set, not set or unreadable, and never what it is', async () => {
    const f = stubBuffer().fetch;
    expect(await publisher(f).buffer.keyState()).toBe('set');
    expect(await publisher(f, {}, null).buffer.keyState()).toBe('not_set');
    expect(
      await publisher(f, {}, stored(KEY, new SecretBox(`${SECRET}-rotated`))).buffer.keyState(),
    ).toBe('unreadable');
    expect(await publisher(f, {}, stored(), null).buffer.readiness()).toEqual({
      ready: false,
      reason: 'unreadable',
    });
  });

  it('refuses a card address that is not an absolute web address', async () => {
    const stub = stubBuffer();
    const { buffer } = publisher(stub.fetch);
    expect(
      await failureOf(buffer.publish({ ...X, imageUrl: '/social-card/x/card.png' })),
    ).toBeInstanceOf(SocialRefusal);
    expect(stub.seen).toEqual([]);
  });
});
