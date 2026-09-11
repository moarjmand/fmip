import {
  MAX_REASON_TAGS,
  PREDICTION_REASON_TAGS,
  type PredictionReasonTag,
  type SubmitPredictionRequest,
} from '@fmip/contracts';

/**
 * Turns the prediction form's fields into the API request (T-050). Pure so
 * it is unit-tested; it does not validate beyond shaping — the API names
 * every invalid field and the form shows what it was told.
 */
export const REASON_TAG_LABEL: Record<PredictionReasonTag, string> = {
  form: 'Form',
  lineup: 'Line-up',
  home_advantage: 'Home advantage',
  injuries: 'Injuries',
  tactics: 'Tactics',
  fatigue: 'Fatigue',
  competition_importance: 'Competition importance',
  head_to_head: 'Head-to-head',
  motivation: 'Motivation',
};

export const OUTCOME_LABEL = { home: 'Home win', draw: 'Draw', away: 'Away win' } as const;

export function formToSubmission(form: FormData): SubmitPredictionRequest {
  const text = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
  const outcome = text('outcome');
  const home = text('score_home');
  const away = text('score_away');
  const score = home !== '' && away !== '' ? { home: Number(home), away: Number(away) } : null;
  const tags = form
    .getAll('reason_tags')
    .filter(
      (t): t is PredictionReasonTag =>
        typeof t === 'string' && (PREDICTION_REASON_TAGS as readonly string[]).includes(t),
    )
    .slice(0, MAX_REASON_TAGS + 1); // one over, so the API can say "at most 3"
  const explanation = text('explanation');
  return {
    // Cast: the API validates the outcome; the form only forwards it.
    outcome: outcome as SubmitPredictionRequest['outcome'],
    score,
    confidence: Number(text('confidence')),
    reason_tags: tags,
    explanation: explanation === '' ? null : explanation,
  };
}

/** Predictions lock at kick-off (blueprint 6.6); the API is the authority, this only shapes the page. */
export function isLocked(kickoffAt: string, now: number = Date.now()): boolean {
  return Date.parse(kickoffAt) <= now;
}
