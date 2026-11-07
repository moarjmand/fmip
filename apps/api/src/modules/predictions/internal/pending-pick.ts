import type { PendingPickStatus, PredictionOutcome } from '@fmip/contracts';

/**
 * The rules of a pending pick that are not SQL (T-1740, D-361), pure, so the
 * spec covers them without a database: what a body must be, what the member
 * is told when they choose, what a choice does to the pick already waiting,
 * and what a confirmation makes of each pick that waited.
 */

const OUTCOMES: readonly string[] = ['home', 'draw', 'away'];

export type ValidatedPick =
  { ok: true; outcome: PredictionOutcome } | { ok: false; fields: Record<string, string> };

/** The body of `PUT /fixtures/:fixtureId/pending-pick`: an outcome and nothing else. */
export function validatePendingPick(body: unknown): ValidatedPick {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, fields: { body: 'must be an object' } };
  }
  const fields: Record<string, string> = {};
  const { outcome, ...rest } = body as Record<string, unknown>;
  if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome)) {
    fields.outcome = 'must be home, draw or away';
  }
  // A score, a confidence or a reason is a prediction's; nothing is kept that
  // the member was not told would be.
  for (const name of Object.keys(rest)) fields[name] = 'is not part of a pending pick';
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, outcome: outcome as PredictionOutcome };
}

/**
 * What a pick is now. A row still `pending` once its match has kicked off is
 * `expired` whether or not anything has written that down yet: kick-off is
 * what expires it, not the job that records it.
 */
export function standingStatus(
  stored: PendingPickStatus,
  kickoffAt: Date,
  now: Date,
): PendingPickStatus {
  return stored === 'pending' && kickoffAt.getTime() <= now.getTime() ? 'expired' : stored;
}

export type SaveRefusal = 'email_verified' | 'unknown_fixture' | 'locked';

/**
 * Whether a member may leave a pending pick on a match, in the order the
 * answers matter: a member whose address is confirmed has nothing to wait
 * for and predicts (the ordinary route); then the match must exist; then it
 * must not have kicked off, the same lock as any prediction.
 */
export function saveRefusal(input: {
  emailVerified: boolean;
  kickoffAt: Date | null;
  now: Date;
}): SaveRefusal | null {
  if (input.emailVerified) return 'email_verified';
  if (input.kickoffAt === null) return 'unknown_fixture';
  if (input.kickoffAt.getTime() <= input.now.getTime()) return 'locked';
  return null;
}

/**
 * What choosing `outcome` does to the pick already waiting on the match:
 * nothing waiting, it is `add`ed; the same outcome again, the waiting pick is
 * `keep`t as it is (no new row, nothing counted); another outcome, the
 * waiting pick is resolved as replaced and the new one added.
 */
export function savePlan(
  waiting: { outcome: PredictionOutcome } | null,
  outcome: PredictionOutcome,
): 'add' | 'keep' | 'replace' {
  if (waiting === null) return 'add';
  return waiting.outcome === outcome ? 'keep' : 'replace';
}

/** How the predictions boundary answered when asked to write a waiting pick as a prediction. */
export type ConversionAnswer =
  /** The member already has a prediction on the match (an earlier run wrote it). */
  'already_predicted' | 'submitted' | 'locked' | 'unknown_fixture';

/**
 * What a confirmation makes of one waiting pick. Written as a prediction, or
 * already one: `converted`. The match kicked off first, or is gone:
 * `expired` -- saved, not counted.
 */
export function resolutionOf(answer: ConversionAnswer): 'converted' | 'expired' {
  return answer === 'submitted' || answer === 'already_predicted' ? 'converted' : 'expired';
}
