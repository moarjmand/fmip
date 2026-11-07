import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_PICK_CONFIDENCE,
  type PendingPick,
  type SubmitPredictionRequest,
} from '@fmip/contracts';
import { IdentityService } from '../identity/identity.service';
import {
  type ConversionAnswer,
  resolutionOf,
  saveRefusal,
  validatePendingPick,
} from './internal/pending-pick';
import {
  PendingPickRefusedError,
  PostgresPendingPickStore,
  type ResolvedPicks,
  type WaitingPick,
} from './internal/pending-pick-store';
import { PredictionsService, type Submitter } from './predictions.service';

export type SavePendingOutcome =
  | { kind: 'saved'; pick: PendingPick }
  | { kind: 'invalid'; fields: Record<string, string> }
  | { kind: 'email_verified' }
  | { kind: 'unknown_fixture' }
  | { kind: 'locked'; locksAt: string }
  | { kind: 'rate_limited' };

export type WithdrawPendingOutcome = 'withdrawn' | 'none_waiting' | 'unknown_fixture' | 'locked';

/**
 * A pick made before the member confirmed their e-mail address (T-1740,
 * D-361): saved as pending, and a prediction only if the address is confirmed
 * before kick-off.
 *
 * **Not a prediction.** It has its own table and this service is the only
 * thing that reads it; the consensus, the settlement, the history, the
 * friends' alerts and the rating read `user_prediction` and never see it
 * (rules 6 and 8). It is answered to its owner and to nobody else.
 *
 * **How one becomes a prediction.** Identity tells whoever asked that an
 * address was confirmed (`IdentityService.onEmailVerified`, registered here
 * at start-up -- this boundary already imports identity, and identity imports
 * nothing of this one). `convertFor` then hands each waiting pick to
 * `PredictionsService.submit`, the boundary's ordinary path: an ordinary
 * first version, timed by the database at that moment, refused after
 * kick-off by the same lock as any prediction. Nothing is back-dated and
 * nothing is written into a prediction's tables from here.
 */
@Injectable()
export class PendingPickService implements OnModuleInit {
  private readonly log = new Logger('PendingPick');

  constructor(
    private readonly store: PostgresPendingPickStore,
    private readonly predictions: PredictionsService,
    private readonly identity: IdentityService,
  ) {}

  onModuleInit(): void {
    this.identity.onEmailVerified(async (userId) => {
      await this.convertFor(userId);
    });
  }

  /** The member's own pick on the match as it stands now, or null. */
  own(userId: string, fixtureId: string): Promise<PendingPick | null> {
    return this.store.newest(userId, fixtureId);
  }

  /**
   * Leaves the member's choice waiting on the match, in place of one already
   * waiting. Refused for a member whose address is confirmed (they predict),
   * for an unknown match and after kick-off -- checked here against the
   * predictions boundary's clock for the plain answer, and again by the
   * database against its own, which has the last word.
   */
  async save(who: Submitter, fixtureId: string, body: unknown): Promise<SavePendingOutcome> {
    const validated = validatePendingPick(body);
    const kickoffAt = who.emailVerified ? null : await this.store.kickoffOf(fixtureId);
    const refused = saveRefusal({
      emailVerified: who.emailVerified,
      kickoffAt,
      now: this.predictions.clock(),
    });
    if (refused === 'email_verified' || refused === 'unknown_fixture') return { kind: refused };
    if (refused === 'locked') {
      return { kind: 'locked', locksAt: (kickoffAt as Date).toISOString() };
    }
    if (!validated.ok) return { kind: 'invalid', fields: validated.fields };
    try {
      await this.store.save(who.id, fixtureId, validated.outcome);
    } catch (error: unknown) {
      if (!(error instanceof PendingPickRefusedError)) throw error;
      if (error.reason === 'locked') {
        return { kind: 'locked', locksAt: (kickoffAt as Date).toISOString() };
      }
      return { kind: error.reason };
    }
    const pick = await this.store.newest(who.id, fixtureId);
    if (pick === null) throw new Error('pending pick vanished after save');
    return { kind: 'saved', pick };
  }

  /** The member takes back the pick waiting on a match that has not kicked off. */
  async withdraw(userId: string, fixtureId: string): Promise<WithdrawPendingOutcome> {
    if (await this.store.withdraw(userId, fixtureId)) return 'withdrawn';
    const kickoffAt = await this.store.kickoffOf(fixtureId);
    if (kickoffAt === null) return 'unknown_fixture';
    const standing = await this.store.newest(userId, fixtureId);
    // Saved, not counted: it is kept and said, never quietly removed.
    return standing !== null && standing.status === 'expired' ? 'locked' : 'none_waiting';
  }

  /**
   * The member's address has just been confirmed: every pick of theirs still
   * waiting becomes a prediction if its match has not kicked off, and is
   * recorded as expired if it has.
   *
   * Safe to run twice: a pick is decided under its row's lock and only while
   * it is waiting, and a match the member already has a prediction on is not
   * written again. It never throws for a single pick -- a match that kicked
   * off meanwhile is an answer, and a write that failed leaves that pick
   * waiting, logged -- so a confirmation is never undone by a pick.
   */
  convertFor(userId: string): Promise<ResolvedPicks> {
    return this.store
      .resolveWaiting(
        userId,
        async (pick) => resolutionOf(await this.asPrediction(userId, pick)),
        (pick, error) => {
          this.log.error(
            `pending_pick.convert_failed member=${userId} fixture=${pick.fixtureId}`,
            error instanceof Error ? error.stack : String(error),
          );
        },
      )
      .then((done) => {
        if (done.converted + done.expired + done.left > 0) {
          this.log.log(
            `pending_pick.resolved member=${userId} converted=${done.converted} expired=${done.expired} left=${done.left}`,
          );
        }
        return done;
      });
  }

  /** Writes one waiting pick as the member's prediction, through the boundary's own path. */
  private async asPrediction(userId: string, pick: WaitingPick): Promise<ConversionAnswer> {
    if ((await this.predictions.own(userId, pick.fixtureId)) !== null) return 'already_predicted';
    const body: SubmitPredictionRequest = {
      outcome: pick.outcome,
      confidence: DEFAULT_PICK_CONFIDENCE,
    };
    const outcome = await this.predictions.submit(
      { id: userId, emailVerified: true },
      pick.fixtureId,
      body,
    );
    switch (outcome.kind) {
      case 'submitted':
      case 'locked':
      case 'unknown_fixture':
        return outcome.kind;
      default:
        // `invalid` and `email_unverified` cannot come from the body and the
        // member above; if one does, the pick is left waiting and it is logged.
        throw new Error(`a waiting pick was refused as a prediction: ${outcome.kind}`);
    }
  }
}
