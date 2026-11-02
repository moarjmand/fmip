import { Injectable, Logger } from '@nestjs/common';
import {
  PREDICTION_SHARE_TOKEN,
  type CalledItCard,
  type OwnPredictionShareResponse,
  type PredictionShare,
} from '@fmip/contracts';
import { cardOf, newShareToken } from './internal/share';
import { PostgresShareStore } from './internal/share-store';

export type CreateShareOutcome =
  | { ok: true; share: PredictionShare; created: boolean }
  | { ok: false; reason: 'not_found' | 'not_called' | 'rate_limited' };

function code(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/**
 * A public link to one correct prediction's card (T-1723, D-351).
 *
 * **Public only by its owner's action.** A member's predictions are seen by
 * whom their profile says (D-063); this is the one exception, and it is one
 * prediction, made public when its owner presses Share and private again when
 * they revoke it. A prediction that is somebody else's answers exactly as one
 * that does not exist (not found), so the route says nothing about who
 * predicted what. The public read checks the card again every time: a link
 * whose prediction was later settled wrong or void, or whose member left,
 * opens nothing.
 */
@Injectable()
export class PredictionShareService {
  private readonly log = new Logger('PredictionShare');

  constructor(private readonly store: PostgresShareStore) {}

  /** The owner's view: the card and its live link, or why there is no card. Null: not theirs. */
  async own(userId: string, predictionId: string): Promise<OwnPredictionShareResponse | null> {
    const row = await this.store.shareable(predictionId);
    if (row === null || row.user_id !== userId) return null;
    const verdict = cardOf(row);
    if (verdict.kind === 'not_called') return verdict;
    return { kind: 'called', card: verdict.card, share: await this.store.live(predictionId) };
  }

  async create(userId: string, predictionId: string): Promise<CreateShareOutcome> {
    const row = await this.store.shareable(predictionId);
    if (row === null || row.user_id !== userId) return { ok: false, reason: 'not_found' };
    if (cardOf(row).kind !== 'called') return { ok: false, reason: 'not_called' };
    try {
      const made = await this.store.create(predictionId, userId, newShareToken());
      if (made.created) this.log.log(`prediction_share.created prediction=${predictionId}`);
      return { ok: true, ...made };
    } catch (error: unknown) {
      if (code(error) === 'PL005') return { ok: false, reason: 'rate_limited' };
      // The schema's owner guard: only reachable if the read above raced a change.
      if (code(error) === 'PL006') return { ok: false, reason: 'not_found' };
      throw error;
    }
  }

  /** Revokes the live link. False: the prediction is not the caller's. */
  async revoke(userId: string, predictionId: string): Promise<boolean> {
    const row = await this.store.shareable(predictionId);
    if (row === null || row.user_id !== userId) return false;
    if (await this.store.revoke(predictionId)) {
      this.log.log(`prediction_share.revoked prediction=${predictionId}`);
    }
    return true;
  }

  /** What a live link shows, or null: no such token, revoked, no longer called, or the member gone. */
  async card(token: string): Promise<CalledItCard | null> {
    if (!PREDICTION_SHARE_TOKEN.test(token)) return null;
    const predictionId = await this.store.predictionOf(token);
    if (predictionId === null) return null;
    const row = await this.store.shareable(predictionId);
    if (row === null || row.account_status !== 'active') return null;
    const verdict = cardOf(row);
    return verdict.kind === 'called' ? verdict.card : null;
  }
}
