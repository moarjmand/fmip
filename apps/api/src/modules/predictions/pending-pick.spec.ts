import type {
  PendingPick,
  PendingPickStatus,
  Prediction,
  PredictionOutcome,
} from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IdentityService,
  type EmailVerifiedListener,
} from '../identity/identity.service';
import {
  resolutionOf,
  savePlan,
  saveRefusal,
  standingStatus,
  validatePendingPick,
} from './internal/pending-pick';
import {
  PendingPickRefusedError,
  type PendingPickStore,
  type PostgresPendingPickStore,
  type ResolvedPicks,
  type WaitingPick,
} from './internal/pending-pick-store';
import { PendingPickService } from './pending-pick.service';
import type { PredictionsService, SubmitOutcome, Submitter } from './predictions.service';

/**
 * The rules of a pending pick (T-1740, D-361) without a database: the pure
 * ones, and the service over a store kept in memory and a predictions
 * boundary that records what it was asked to write. What the schema itself
 * refuses, and the whole path from registering to the stored prediction, is
 * `pending-pick.http.spec.ts`.
 */

const KICKOFF = new Date('2026-11-08T17:30:00Z');
const BEFORE = new Date('2026-11-08T17:29:59Z');
const AT = new Date('2026-11-08T17:30:00Z');
const FIXTURE = '00000000-0000-4000-8000-00000000f001';
const OTHER_FIXTURE = '00000000-0000-4000-8000-00000000f002';
const MEMBER = '00000000-0000-4000-8000-00000000a001';
const unverified: Submitter = { id: MEMBER, emailVerified: false };

describe('validatePendingPick', () => {
  it('takes an outcome and nothing else', () => {
    expect(validatePendingPick({ outcome: 'draw' })).toEqual({ ok: true, outcome: 'draw' });
  });

  it('refuses anything that is not home, draw or away', () => {
    for (const body of [{}, { outcome: 'HOME' }, { outcome: 1 }, { outcome: null }]) {
      expect(validatePendingPick(body)).toEqual({
        ok: false,
        fields: { outcome: 'must be home, draw or away' },
      });
    }
  });

  it('refuses a score, a confidence or a reason: those are a prediction’s', () => {
    expect(
      validatePendingPick({ outcome: 'home', score: { home: 2, away: 1 }, confidence: 5 }),
    ).toEqual({
      ok: false,
      fields: {
        score: 'is not part of a pending pick',
        confidence: 'is not part of a pending pick',
      },
    });
  });

  it('refuses a body that is not an object', () => {
    for (const body of [null, undefined, 'home', ['home']]) {
      expect(validatePendingPick(body)).toEqual({
        ok: false,
        fields: { body: 'must be an object' },
      });
    }
  });
});

describe('standingStatus', () => {
  it('reads a pick still waiting at kick-off as expired, on the instant', () => {
    expect(standingStatus('pending', KICKOFF, BEFORE)).toBe('pending');
    expect(standingStatus('pending', KICKOFF, AT)).toBe('expired');
  });

  it('leaves what was already recorded as it is', () => {
    for (const status of ['converted', 'expired', 'replaced', 'withdrawn'] as const) {
      expect(standingStatus(status, KICKOFF, AT)).toBe(status);
      expect(standingStatus(status, KICKOFF, BEFORE)).toBe(status);
    }
  });
});

describe('saveRefusal', () => {
  it('lets a member whose address is not confirmed pick before kick-off', () => {
    expect(saveRefusal({ emailVerified: false, kickoffAt: KICKOFF, now: BEFORE })).toBeNull();
  });

  it('refuses a member whose address is confirmed, whatever the match', () => {
    expect(saveRefusal({ emailVerified: true, kickoffAt: KICKOFF, now: BEFORE })).toBe(
      'email_verified',
    );
    expect(saveRefusal({ emailVerified: true, kickoffAt: null, now: BEFORE })).toBe(
      'email_verified',
    );
  });

  it('refuses an unknown match, and a match at or after kick-off', () => {
    expect(saveRefusal({ emailVerified: false, kickoffAt: null, now: BEFORE })).toBe(
      'unknown_fixture',
    );
    expect(saveRefusal({ emailVerified: false, kickoffAt: KICKOFF, now: AT })).toBe('locked');
  });
});

describe('savePlan', () => {
  it('adds the first choice, keeps the same one, replaces another', () => {
    expect(savePlan(null, 'home')).toBe('add');
    expect(savePlan({ outcome: 'home' }, 'home')).toBe('keep');
    expect(savePlan({ outcome: 'home' }, 'away')).toBe('replace');
  });
});

describe('resolutionOf', () => {
  it('converts what was written or already stood, and expires what kick-off or a lost match stopped', () => {
    expect(resolutionOf('submitted')).toBe('converted');
    expect(resolutionOf('already_predicted')).toBe('converted');
    expect(resolutionOf('locked')).toBe('expired');
    expect(resolutionOf('unknown_fixture')).toBe('expired');
  });
});

interface Row {
  id: string;
  userId: string;
  fixtureId: string;
  outcome: PredictionOutcome;
  status: PendingPickStatus;
}

/** The store's contract in memory: the same plan, one waiting pick per member and match. */
class MemoryStore implements PendingPickStore {
  rows: Row[] = [];
  kickoffs = new Map<string, Date>([
    [FIXTURE, KICKOFF],
    [OTHER_FIXTURE, KICKOFF],
  ]);
  now = BEFORE;
  refuse: PendingPickRefusedError | null = null;

  async kickoffOf(fixtureId: string): Promise<Date | null> {
    return this.kickoffs.get(fixtureId) ?? null;
  }

  private waiting(userId: string, fixtureId: string): Row | undefined {
    return this.rows.find(
      (r) => r.userId === userId && r.fixtureId === fixtureId && r.status === 'pending',
    );
  }

  async newest(userId: string, fixtureId: string): Promise<PendingPick | null> {
    const mine = this.rows.filter((r) => r.userId === userId && r.fixtureId === fixtureId);
    const row = this.waiting(userId, fixtureId) ?? mine.at(-1);
    if (row === undefined) return null;
    const kickoff = this.kickoffs.get(fixtureId) ?? KICKOFF;
    return {
      id: row.id,
      fixture_id: row.fixtureId,
      outcome: row.outcome,
      status: standingStatus(row.status, kickoff, this.now),
      saved_at: BEFORE.toISOString(),
      resolved_at: row.status === 'pending' ? null : this.now.toISOString(),
      counts_before: kickoff.toISOString(),
    };
  }

  async save(userId: string, fixtureId: string, outcome: PredictionOutcome): Promise<void> {
    if (this.refuse !== null) throw this.refuse;
    const waiting = this.waiting(userId, fixtureId);
    const plan = savePlan(waiting ?? null, outcome);
    if (plan === 'keep') return;
    if (waiting !== undefined) waiting.status = 'replaced';
    this.rows.push({
      id: `pick-${this.rows.length + 1}`,
      userId,
      fixtureId,
      outcome,
      status: 'pending',
    });
  }

  async withdraw(userId: string, fixtureId: string): Promise<boolean> {
    const waiting = this.waiting(userId, fixtureId);
    const kickoff = this.kickoffs.get(fixtureId);
    if (waiting === undefined || kickoff === undefined || kickoff <= this.now) return false;
    waiting.status = 'withdrawn';
    return true;
  }

  async resolveWaiting(
    userId: string,
    decide: (pick: WaitingPick) => Promise<'converted' | 'expired'>,
    failed: (pick: WaitingPick, error: unknown) => void,
  ): Promise<ResolvedPicks> {
    const done: ResolvedPicks = { converted: 0, expired: 0, left: 0 };
    for (const row of this.rows.filter((r) => r.userId === userId && r.status === 'pending')) {
      const pick = { id: row.id, fixtureId: row.fixtureId, outcome: row.outcome };
      try {
        row.status = await decide(pick);
        done[row.status as 'converted' | 'expired'] += 1;
      } catch (error) {
        done.left += 1;
        failed(pick, error);
      }
    }
    return done;
  }
}

/** The predictions boundary's public path, recording what it was asked. */
class FakePredictions {
  now = BEFORE;
  clock = (): Date => this.now;
  submitted: { who: Submitter; fixtureId: string; body: unknown }[] = [];
  held = new Set<string>();
  answers = new Map<string, SubmitOutcome | Error>();

  async own(_userId: string, fixtureId: string): Promise<Prediction | null> {
    return this.held.has(fixtureId) ? ({ id: 'p' } as Prediction) : null;
  }

  async submit(who: Submitter, fixtureId: string, body: unknown): Promise<SubmitOutcome> {
    this.submitted.push({ who, fixtureId, body });
    const answer = this.answers.get(fixtureId);
    if (answer instanceof Error) throw answer;
    if (answer !== undefined) return answer;
    this.held.add(fixtureId);
    return { kind: 'submitted', prediction: { id: 'p' } as Prediction };
  }
}

function setup() {
  const store = new MemoryStore();
  const predictions = new FakePredictions();
  const listeners: EmailVerifiedListener[] = [];
  const identity = {
    onEmailVerified: (listener: EmailVerifiedListener) => listeners.push(listener),
  } as unknown as IdentityService;
  const service = new PendingPickService(
    store as unknown as PostgresPendingPickStore,
    predictions as unknown as PredictionsService,
    identity,
  );
  const statuses = () => store.rows.map((r) => `${r.outcome}:${r.status}`);
  return { store, predictions, listeners, service, statuses };
}

describe('PendingPickService.save', () => {
  it('saves the choice of a member whose address is not confirmed', async () => {
    const { service, statuses } = setup();
    const saved = await service.save(unverified, FIXTURE, { outcome: 'home' });
    expect(saved).toMatchObject({
      kind: 'saved',
      pick: { outcome: 'home', status: 'pending', counts_before: KICKOFF.toISOString() },
    });
    expect(statuses()).toEqual(['home:pending']);
  });

  it('replaces the waiting pick when the member chooses again, and keeps what it was', async () => {
    const { service, statuses } = setup();
    await service.save(unverified, FIXTURE, { outcome: 'home' });
    const again = await service.save(unverified, FIXTURE, { outcome: 'away' });
    expect(again).toMatchObject({ kind: 'saved', pick: { outcome: 'away', status: 'pending' } });
    expect(statuses()).toEqual(['home:replaced', 'away:pending']);
  });

  it('adds nothing when the same outcome is chosen again', async () => {
    const { service, statuses } = setup();
    await service.save(unverified, FIXTURE, { outcome: 'draw' });
    await service.save(unverified, FIXTURE, { outcome: 'draw' });
    expect(statuses()).toEqual(['draw:pending']);
  });

  it('refuses a member whose address is confirmed and stores nothing', async () => {
    const { service, store } = setup();
    const outcome = await service.save({ id: MEMBER, emailVerified: true }, FIXTURE, {
      outcome: 'home',
    });
    expect(outcome).toEqual({ kind: 'email_verified' });
    expect(store.rows).toEqual([]);
  });

  it('refuses an unknown match, a match that has kicked off and a body that is not a pick', async () => {
    const { service, store, predictions } = setup();
    expect(await service.save(unverified, 'no-such-match', { outcome: 'home' })).toEqual({
      kind: 'unknown_fixture',
    });
    expect(await service.save(unverified, FIXTURE, { outcome: 'win' })).toEqual({
      kind: 'invalid',
      fields: { outcome: 'must be home, draw or away' },
    });
    predictions.now = AT;
    expect(await service.save(unverified, FIXTURE, { outcome: 'home' })).toEqual({
      kind: 'locked',
      locksAt: KICKOFF.toISOString(),
    });
    expect(store.rows).toEqual([]);
  });

  it('takes the database’s word when it refuses what this clock let through', async () => {
    const { service, store } = setup();
    store.refuse = new PendingPickRefusedError('locked');
    expect(await service.save(unverified, FIXTURE, { outcome: 'home' })).toEqual({
      kind: 'locked',
      locksAt: KICKOFF.toISOString(),
    });
    store.refuse = new PendingPickRefusedError('email_verified');
    expect(await service.save(unverified, FIXTURE, { outcome: 'home' })).toEqual({
      kind: 'email_verified',
    });
    store.refuse = new PendingPickRefusedError('rate_limited');
    expect(await service.save(unverified, FIXTURE, { outcome: 'home' })).toEqual({
      kind: 'rate_limited',
    });
  });
});

describe('PendingPickService.withdraw', () => {
  it('takes back the waiting pick before kick-off, once', async () => {
    const { service, statuses } = setup();
    await service.save(unverified, FIXTURE, { outcome: 'home' });
    expect(await service.withdraw(MEMBER, FIXTURE)).toBe('withdrawn');
    expect(statuses()).toEqual(['home:withdrawn']);
    expect(await service.withdraw(MEMBER, FIXTURE)).toBe('none_waiting');
    expect(await service.withdraw(MEMBER, 'no-such-match')).toBe('unknown_fixture');
  });

  it('does not remove a pick that kick-off left saved and not counted', async () => {
    const { service, store, statuses } = setup();
    await service.save(unverified, FIXTURE, { outcome: 'home' });
    store.now = AT;
    expect(await service.withdraw(MEMBER, FIXTURE)).toBe('locked');
    expect(statuses()).toEqual(['home:pending']);
    expect((await service.own(MEMBER, FIXTURE))?.status).toBe('expired');
  });
});

describe('PendingPickService.convertFor', () => {
  it('writes a waiting pick as an ordinary first prediction, by the boundary’s own path', async () => {
    const { service, predictions, statuses } = setup();
    await service.save(unverified, FIXTURE, { outcome: 'away' });
    expect(await service.convertFor(MEMBER)).toEqual({ converted: 1, expired: 0, left: 0 });
    expect(predictions.submitted).toEqual([
      {
        // The member is confirmed by now; the body is the one-tap pick's.
        who: { id: MEMBER, emailVerified: true },
        fixtureId: FIXTURE,
        body: { outcome: 'away', confidence: 3 },
      },
    ]);
    expect(statuses()).toEqual(['away:converted']);
  });

  it('converts only the pick that was waiting, never one that was replaced or withdrawn', async () => {
    const { service, predictions, statuses } = setup();
    await service.save(unverified, FIXTURE, { outcome: 'home' });
    await service.save(unverified, FIXTURE, { outcome: 'draw' });
    await service.save(unverified, OTHER_FIXTURE, { outcome: 'away' });
    await service.withdraw(MEMBER, OTHER_FIXTURE);
    await service.convertFor(MEMBER);
    expect(predictions.submitted.map((s) => s.body)).toEqual([{ outcome: 'draw', confidence: 3 }]);
    expect(statuses()).toEqual(['home:replaced', 'draw:converted', 'away:withdrawn']);
  });

  it('records a pick whose match kicked off first as expired, and does not throw', async () => {
    const { service, predictions, statuses } = setup();
    await service.save(unverified, FIXTURE, { outcome: 'home' });
    predictions.answers.set(FIXTURE, { kind: 'locked', locksAt: KICKOFF.toISOString() });
    expect(await service.convertFor(MEMBER)).toEqual({ converted: 0, expired: 1, left: 0 });
    expect(statuses()).toEqual(['home:expired']);
  });

  it('is safe to run twice: the second run finds nothing waiting and writes nothing', async () => {
    const { service, predictions } = setup();
    await service.save(unverified, FIXTURE, { outcome: 'home' });
    await service.convertFor(MEMBER);
    expect(await service.convertFor(MEMBER)).toEqual({ converted: 0, expired: 0, left: 0 });
    expect(predictions.submitted).toHaveLength(1);
  });

  it('does not write a second prediction on a match the member already predicted', async () => {
    const { service, predictions, statuses } = setup();
    await service.save(unverified, FIXTURE, { outcome: 'home' });
    predictions.held.add(FIXTURE);
    expect(await service.convertFor(MEMBER)).toEqual({ converted: 1, expired: 0, left: 0 });
    expect(predictions.submitted).toEqual([]);
    expect(statuses()).toEqual(['home:converted']);
  });

  it('leaves a pick waiting when writing it failed, and still decides the others', async () => {
    const { service, predictions, statuses } = setup();
    await service.save(unverified, FIXTURE, { outcome: 'home' });
    await service.save(unverified, OTHER_FIXTURE, { outcome: 'draw' });
    predictions.answers.set(FIXTURE, new Error('connection terminated'));
    expect(await service.convertFor(MEMBER)).toEqual({ converted: 1, expired: 0, left: 1 });
    expect(statuses()).toEqual(['home:pending', 'draw:converted']);
    // The next run tries the one that was left.
    predictions.answers.delete(FIXTURE);
    expect(await service.convertFor(MEMBER)).toEqual({ converted: 1, expired: 0, left: 0 });
    expect(statuses()).toEqual(['home:converted', 'draw:converted']);
  });

  it('is what identity is told to do when an address is confirmed', async () => {
    const { service, listeners, statuses } = setup();
    service.onModuleInit();
    expect(listeners).toHaveLength(1);
    await service.save(unverified, FIXTURE, { outcome: 'home' });
    await listeners[0]?.(MEMBER);
    expect(statuses()).toEqual(['home:converted']);
  });
});

describe('IdentityService.onEmailVerified', () => {
  function identity(userIdOfToken: string | null) {
    const marked: string[] = [];
    const service = new IdentityService(
      {
        consumeEmailToken: async () => userIdOfToken,
        markEmailVerified: async (userId: string) => {
          marked.push(userId);
        },
      } as never,
      {} as never,
      {} as never,
      { send: async () => undefined } as never,
      {
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 's'.repeat(32),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      },
      { take: async () => ({ ok: true }) } as never,
      {} as never,
    );
    return { service, marked };
  }

  it('tells each listener after the address is marked confirmed', async () => {
    const { service, marked } = identity(MEMBER);
    const told: string[] = [];
    service.onEmailVerified(async (userId) => {
      // By the time a listener runs the address is confirmed.
      told.push(`${userId}:${marked.length}`);
    });
    expect(await service.verifyEmail('token')).toBe(true);
    expect(told).toEqual([`${MEMBER}:1`]);
  });

  it('confirms the address even when a listener throws, and still tells the next one', async () => {
    const { service, marked } = identity(MEMBER);
    const told: string[] = [];
    service.onEmailVerified(async () => {
      throw new Error('a pick could not be written');
    });
    service.onEmailVerified(async (userId) => {
      told.push(userId);
    });
    expect(await service.verifyEmail('token')).toBe(true);
    expect(marked).toEqual([MEMBER]);
    expect(told).toEqual([MEMBER]);
  });

  it('tells nobody when the token is not one', async () => {
    const { service } = identity(null);
    const told: string[] = [];
    service.onEmailVerified(async (userId) => {
      told.push(userId);
    });
    expect(await service.verifyEmail('token')).toBe(false);
    expect(told).toEqual([]);
  });
});
