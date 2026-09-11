import {
  MAX_EXPLANATION_LENGTH,
  MAX_REASON_TAGS,
  PREDICTION_REASON_TAGS,
  type PredictionOutcome,
  type PredictionReasonTag,
} from '@fmip/contracts';

/** A submission after validation; what the store writes. */
export interface PredictionInput {
  outcome: PredictionOutcome;
  score: { home: number; away: number } | null;
  confidence: number;
  reasonTags: PredictionReasonTag[];
  explanation: string | null;
}

export type Validated =
  { ok: true; value: PredictionInput } | { ok: false; fields: Record<string, string> };

const OUTCOMES: readonly string[] = ['home', 'draw', 'away'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGoals(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 20;
}

/**
 * Every problem named at once, the same rules the database enforces
 * (migration 1758800000000), so a client learns them from a 400 rather than
 * from a constraint name.
 */
export function validateSubmission(body: unknown): Validated {
  if (!isRecord(body)) return { ok: false, fields: { body: 'must be an object' } };
  const fields: Record<string, string> = {};

  const outcome = body.outcome;
  if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome)) {
    fields.outcome = 'must be home, draw or away';
  }

  let score: { home: number; away: number } | null = null;
  if (body.score !== undefined && body.score !== null) {
    if (!isRecord(body.score) || !isGoals(body.score.home) || !isGoals(body.score.away)) {
      fields.score = 'must be { home, away } with whole numbers from 0 to 20';
    } else {
      score = { home: body.score.home, away: body.score.away };
      const implied = score.home > score.away ? 'home' : score.home < score.away ? 'away' : 'draw';
      if (fields.outcome === undefined && implied !== outcome) {
        fields.score = `does not match the outcome (${String(outcome)})`;
      }
    }
  }

  const confidence = body.confidence;
  if (
    typeof confidence !== 'number' ||
    !Number.isInteger(confidence) ||
    confidence < 1 ||
    confidence > 5
  ) {
    fields.confidence = 'must be a whole number from 1 to 5';
  }

  let reasonTags: PredictionReasonTag[] = [];
  if (body.reason_tags !== undefined) {
    if (!Array.isArray(body.reason_tags)) {
      fields.reason_tags = 'must be an array';
    } else {
      const unknown = body.reason_tags.filter(
        (t) => typeof t !== 'string' || !(PREDICTION_REASON_TAGS as readonly string[]).includes(t),
      );
      const unique = new Set(body.reason_tags as unknown[]);
      if (unknown.length > 0) {
        fields.reason_tags = `must be from ${PREDICTION_REASON_TAGS.join(', ')}`;
      } else if (unique.size !== body.reason_tags.length) {
        fields.reason_tags = 'must not repeat a tag';
      } else if (body.reason_tags.length > MAX_REASON_TAGS) {
        fields.reason_tags = `at most ${MAX_REASON_TAGS} tags`;
      } else {
        reasonTags = body.reason_tags as PredictionReasonTag[];
      }
    }
  }

  let explanation: string | null = null;
  if (body.explanation !== undefined && body.explanation !== null) {
    if (typeof body.explanation !== 'string') {
      fields.explanation = 'must be text';
    } else {
      const trimmed = body.explanation.trim();
      if (trimmed.length > MAX_EXPLANATION_LENGTH) {
        fields.explanation = `at most ${MAX_EXPLANATION_LENGTH} characters`;
      } else if (trimmed !== '') {
        explanation = trimmed;
      }
    }
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    value: {
      outcome: outcome as PredictionOutcome,
      score,
      confidence: confidence as number,
      reasonTags,
      explanation,
    },
  };
}
