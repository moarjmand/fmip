import type { SocialNetwork, SocialPostKind, SocialPostState } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import type {
  PostgresSocialPostStore,
  SocialFinish,
  SocialPostRecord,
} from './internal/social-post-store';
import { SocialPublishingScheduler } from './social-publishing-scheduler.service';
import type { PublishCheck, SocialPublishingService } from './social-publishing.service';
import {
  type SocialPublication,
  type SocialPublisher,
  type SocialPublisherReadiness,
  SocialRefusal,
} from './social-publisher.port';

/**
 * The job's publishing step against an in-memory store and a scripted
 * publisher: which post goes out at which slot, and what each answer makes of
 * it. The database's own refusals (one claim, the switch, the cap) are proven
 * against the real schema in `social-publishing.http.spec.ts`.
 */

// November: London is on GMT, so these are London times too.
const at = (hhmm: string, day = '2026-11-16') => new Date(`${day}T${hhmm}:00Z`);

interface Row {
  id: string;
  kind: SocialPostKind;
  network: SocialNetwork;
  state: SocialPostState;
  rank: number | null;
  kick_off: string;
  expires_at: Date;
  updated_at: Date;
  slot: number | null;
  post_day: string | null;
  claimed_at: Date | null;
  provider_ref: string | null;
  error: string | null;
  /** How `finish` was told the post went: a publishing error, or nothing sent. */
  counted: 'error' | 'not_sent' | 'stopped' | null;
}

function world(clock: { now: Date }) {
  const rows = new Map<string, Row>();
  let stopped = false;
  const failing = new Set<string>();
  const add = (id: string, over: Partial<Row> = {}) =>
    rows.set(id, {
      id,
      kind: 'result',
      network: 'x',
      state: 'approved',
      rank: 1,
      kick_off: '2026-11-16T09:00:00Z',
      expires_at: at('16:30', '2026-11-17'),
      updated_at: at('10:00'),
      slot: null,
      post_day: null,
      claimed_at: null,
      provider_ref: null,
      error: null,
      counted: null,
      ...over,
    });
  const held = (network: SocialNetwork, day: string) =>
    [...rows.values()]
      .filter(
        (r) =>
          r.network === network &&
          r.post_day === day &&
          ['publishing', 'published', 'unknown'].includes(r.state),
      )
      .map((r) => r.slot!);

  const store = {
    stopped: async () => stopped,
    exclusive: async <T>(work: () => Promise<T>) => work(),
    heldSlots: async (network: SocialNetwork, day: string) => held(network, day),
    publishable: async (network: SocialNetwork, now: Date) =>
      [...rows.values()]
        .filter(
          (r) =>
            r.network === network &&
            (r.state === 'approved' || r.state === 'refused') &&
            r.expires_at > now,
        )
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          state: r.state,
          approved_by_name: 'p',
          updated_at: r.updated_at,
          expires_at: r.expires_at,
          kick_off: r.kick_off,
          competition_rank: r.rank,
        })),
    staleClaims: async (before: Date) =>
      [...rows.values()]
        .filter((r) => r.state === 'publishing' && r.claimed_at! < before)
        .map((r) => r.id),
    lastByNetwork: async () => [],
  } as unknown as PostgresSocialPostStore;

  const social = {
    draftCandidates: async () => ({}),
    checkAtPublishing: async (id: string): Promise<PublishCheck> => {
      const r = rows.get(id)!;
      if (failing.has(id)) {
        r.state = 'expired';
        return { go: false, why: 'expired', failed: ['freshness'] };
      }
      return {
        go: true,
        post: { id, network: r.network, kind: r.kind, body: `post ${id}` } as SocialPostRecord,
      };
    },
    claim: async (id: string, slot: number) => {
      const r = rows.get(id)!;
      const day = clock.now.toISOString().slice(0, 10);
      if (stopped) return { ok: false, refusal: 'stopped' };
      if (r.state !== 'approved' && r.state !== 'refused')
        return { ok: false, refusal: 'not_claimable' };
      if (held(r.network, day).includes(slot)) return { ok: false, refusal: 'slot_taken' };
      Object.assign(r, { state: 'publishing', slot, post_day: day, claimed_at: clock.now });
      return { ok: true, value: { post_day: day, slot } };
    },
    finish: async (id: string, answer: SocialFinish) => {
      const r = rows.get(id)!;
      r.state = answer.state;
      r.updated_at = clock.now;
      if (answer.state === 'published') r.provider_ref = answer.providerRef;
      else {
        r.error = answer.error;
        r.counted = answer.state === 'refused' ? (answer.notSent ?? 'error') : 'error';
      }
      if (answer.state === 'refused')
        Object.assign(r, { slot: null, post_day: null, claimed_at: null });
      return { ok: true, value: answer.state };
    },
  } as unknown as SocialPublishingService;

  return {
    rows,
    add,
    failing,
    stop: (on: boolean) => {
      stopped = on;
    },
    store,
    social,
  };
}

function scriptedPublisher(
  answers: (() => { providerRef: string })[] = [],
  readiness: SocialPublisherReadiness = { ready: true },
) {
  const sent: SocialPublication[] = [];
  let i = 0;
  const publisher: SocialPublisher & {
    sent: SocialPublication[];
    ready: SocialPublisherReadiness;
  } = {
    provider: 'scripted',
    sent,
    ready: readiness,
    readiness: async () => publisher.ready,
    keyState: async () => 'set',
    keyChanged: () => undefined,
    pausedUntil: () => null,
    publish: async (post) => {
      sent.push(post);
      const answer = answers[Math.min(i, answers.length - 1)];
      i += 1;
      return answer === undefined ? { providerRef: `ref-${sent.length}` } : answer();
    },
  };
  return publisher;
}

function setup(answers?: (() => { providerRef: string })[]) {
  const clock = { now: at('12:05') };
  const w = world(clock);
  const publisher = scriptedPublisher(answers);
  const scheduler = new SocialPublishingScheduler(w.social, w.store, publisher, {
    origin: 'https://stadiomind.test',
  });
  const publish = (network: SocialNetwork, when: Date) => {
    clock.now = when;
    return scheduler.publishDue(network, when);
  };
  return { ...w, clock, publisher, scheduler, publish };
}

describe('the social posts job', () => {
  it('publishes the best-ranked post at the slot due, with its card, and records the reference', async () => {
    const s = setup();
    s.add('late-kick-off', { kick_off: '2026-11-16T11:00:00Z' });
    s.add('lower-rank', { rank: 7, kick_off: '2026-11-16T08:00:00Z' });
    s.add('best');
    s.add('instagram', { network: 'instagram' });

    expect(await s.publish('x', at('12:05'))).toEqual({
      kind: 'published',
      id: 'best',
      providerRef: 'ref-1',
      slot: 2,
    });
    expect(s.publisher.sent).toEqual([
      {
        network: 'x',
        text: 'post best',
        imageUrl: 'https://stadiomind.test/social-card/best/card.png',
      },
    ]);
    expect(s.rows.get('best')).toMatchObject({
      state: 'published',
      provider_ref: 'ref-1',
      slot: 2,
    });
    // One post a slot: the next tick in the same slot publishes nothing more.
    expect(await s.publish('x', at('12:10'))).toEqual({ kind: 'no_slot' });
    // The next slot takes the next in rank.
    expect(await s.publish('x', at('16:30'))).toMatchObject({
      kind: 'published',
      id: 'late-kick-off',
      slot: 3,
    });
  });

  it('never pads: no candidate, no post; nothing in the quiet hours or before the first slot', async () => {
    const s = setup();
    expect(await s.publish('x', at('12:05'))).toEqual({ kind: 'nothing' });
    s.add('a');
    expect(await s.publish('x', at('23:10'))).toEqual({ kind: 'no_slot' });
    expect(await s.publish('x', at('07:30'))).toEqual({ kind: 'no_slot' });
    expect(s.publisher.sent).toEqual([]);
  });

  it('a refusal gives the slot back and tries the post again at the next slot, not the same one', async () => {
    const s = setup([
      () => {
        throw new SocialRefusal('buffer refused (InvalidInputError): nope');
      },
      () => ({ providerRef: 'second-try' }),
    ]);
    s.add('a');
    expect(await s.publish('x', at('12:05'))).toEqual({
      kind: 'refused',
      id: 'a',
      error: 'buffer refused (InvalidInputError): nope',
    });
    expect(s.rows.get('a')).toMatchObject({ state: 'refused', slot: null, counted: 'error' });
    // The slot is free again, but the refused post waits for a slot after its refusal.
    expect(await s.publish('x', at('12:10'))).toEqual({ kind: 'nothing' });
    expect(await s.publish('x', at('16:35'))).toMatchObject({
      kind: 'published',
      id: 'a',
      providerRef: 'second-try',
      slot: 3,
    });
  });

  it('a 429 is a refusal before sending (slot back, run kept), and its pause holds the next ticks', async () => {
    const s = setup([
      () => {
        throw SocialRefusal.beforeSend('buffer rate limit: paused for 753 s', 753_000);
      },
    ]);
    s.add('a');
    expect(await s.publish('x', at('12:05'))).toMatchObject({
      kind: 'not_sent',
      id: 'a',
      why: 'not_sent',
    });
    expect(s.rows.get('a')).toMatchObject({ state: 'refused', slot: null, counted: 'not_sent' });
    s.publisher.ready = { ready: false, reason: 'paused', until: at('12:18') };
    expect(await s.publish('x', at('16:30'))).toEqual({ kind: 'not_ready', reason: 'paused' });
    expect(s.publisher.sent).toHaveLength(1);
  });

  it('no answer is unknown: the slot kept, and the job never tries it again', async () => {
    const s = setup([
      () => {
        throw new Error('buffer did not answer: TimeoutError');
      },
    ]);
    s.add('a');
    expect(await s.publish('x', at('12:05'))).toEqual({
      kind: 'unknown',
      id: 'a',
      error: 'buffer did not answer: TimeoutError',
    });
    expect(s.rows.get('a')).toMatchObject({ state: 'unknown', slot: 2 });
    expect(await s.publish('x', at('16:30'))).toEqual({ kind: 'nothing' });
    expect(s.publisher.sent).toHaveLength(1);
  });

  it('publishes nothing while stopped, with no key or with an unreadable key', async () => {
    const s = setup();
    s.add('a');
    s.stop(true);
    expect(await s.publish('x', at('12:05'))).toEqual({ kind: 'stopped' });
    s.stop(false);
    for (const reason of ['not_set', 'unreadable'] as const) {
      s.publisher.ready = { ready: false, reason };
      expect(await s.publish('x', at('12:05'))).toEqual({ kind: 'not_ready', reason });
    }
    expect(s.publisher.sent).toEqual([]);
    expect(s.rows.get('a')!.state).toBe('approved');
  });

  it('a stop committed after the claim is "stopped": nothing sent, slot back, run kept', async () => {
    const s = setup();
    s.add('a');
    const claim = s.social.claim.bind(s.social);
    s.social.claim = (async (id: string, slot: number) => {
      const claimed = await claim(id, slot);
      s.stop(true);
      return claimed;
    }) as typeof s.social.claim;
    expect(await s.publish('x', at('12:05'))).toEqual({
      kind: 'not_sent',
      id: 'a',
      why: 'stopped',
      error: 'publishing was stopped before sending',
    });
    expect(s.publisher.sent).toEqual([]);
    expect(s.rows.get('a')).toMatchObject({ state: 'refused', slot: null, counted: 'stopped' });
  });

  it("refusals before sending -- no channel, unreachable, too long -- keep the run; Buffer's own refusal does not", async () => {
    for (const [refusal, counted] of [
      [SocialRefusal.beforeSend('no connected, unlocked instagram channel on Buffer'), 'not_sent'],
      [SocialRefusal.beforeSend('buffer unreachable: ENOTFOUND'), 'not_sent'],
      [SocialRefusal.beforeSend('the text is longer than Buffer takes for x'), 'not_sent'],
      [new SocialRefusal('buffer refused (InvalidInputError): nope'), 'error'],
    ] as const) {
      const s = setup([
        () => {
          throw refusal;
        },
      ]);
      s.add('a');
      await s.publish('x', at('12:05'));
      expect(s.rows.get('a')).toMatchObject({ state: 'refused', slot: null, counted });
    }
  });

  it('checks the network channel before claiming: none, and nothing is claimed', async () => {
    const s = setup();
    s.add('a');
    s.publisher.ready = { ready: false, reason: 'channel', detail: 'no instagram channel' };
    expect(await s.publish('x', at('12:05'))).toEqual({ kind: 'not_ready', reason: 'channel' });
    expect(s.rows.get('a')).toMatchObject({ state: 'approved', slot: null });
    expect(s.publisher.sent).toEqual([]);
  });

  it('skips a post whose gate fails at publishing and takes the next', async () => {
    const s = setup();
    s.add('stale');
    s.add('next', { kick_off: '2026-11-16T10:00:00Z' });
    s.failing.add('stale');
    expect(await s.publish('x', at('12:05'))).toMatchObject({ kind: 'published', id: 'next' });
    expect(s.rows.get('stale')!.state).toBe('expired');
    expect(s.publisher.sent.map((p) => p.text)).toEqual(['post next']);
  });

  it('loses the slot to another scheduler without calling the network', async () => {
    const s = setup();
    s.add('a');
    s.add('other', { state: 'published', slot: 2, post_day: '2026-11-16' });
    // The other scheduler's claim landed after this one read the held slots.
    const heldSlots = s.store.heldSlots.bind(s.store);
    s.store.heldSlots = async () => [];
    expect(await s.publish('x', at('12:05'))).toEqual({ kind: 'lost_slot' });
    s.store.heldSlots = heldSlots;
    expect(s.publisher.sent).toEqual([]);
  });

  it('makes a claim left without an answer unknown after ten minutes', async () => {
    const s = setup();
    s.add('lost', {
      state: 'publishing',
      slot: 1,
      post_day: '2026-11-16',
      claimed_at: at('08:30'),
    });
    s.add('fresh', {
      state: 'publishing',
      slot: 2,
      post_day: '2026-11-16',
      claimed_at: at('12:04'),
    });
    s.clock.now = at('12:05');
    expect(await s.scheduler.settleStale(at('12:05'))).toBe(1);
    expect(s.rows.get('lost')).toMatchObject({ state: 'unknown', slot: 1 });
    expect(s.rows.get('fresh')!.state).toBe('publishing');
  });

  it('runs a tick through each network and says what it did', async () => {
    const s = setup();
    s.add('a');
    s.add('b', { network: 'instagram' });
    s.clock.now = at('12:05');
    const tick = await s.scheduler.tick(at('12:05'));
    expect(tick?.published).toMatchObject({
      x: { kind: 'published', id: 'a' },
      instagram: { kind: 'published', id: 'b' },
    });
  });
});
